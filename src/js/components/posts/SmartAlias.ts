import { RE621 } from "../../../RE621";
import { AvoidPosting } from "../../cache/AvoidPosting";
import Page, { PageDefinition } from "../../models/data/Page";
import { TagCategory } from "../../old.components/api/responses/APITag";
import { TagCache } from "../../old.components/cache/TagCache";
import { TagValidator } from "../../old.components/utility/TagValidator";
import Util from "../../utilities/Util";
import Component from "../Component";

export class SmartAlias extends Component {

    // Maximum recursion depth for aliases that contain other aliases
    private static ITERATIONS_LIMIT = 10;

    // Elements to which smart alias instances are to be attached
    private static inputSelector = new Set([
        "#post_tag_string",     // editing form tags
        "#re621_qedit_tags",    // re621's version

        // Yes, this is correct
        "#post_characters",     // artist
        "#post_sexes",          // characters
        "#post_bodyTypes",      // body types
        "#post_themes",         // themes
        "#post_tags",           // other tags
    ]);

    private inputElements: JQuery<HTMLElement>[] = [];

    private static aliasCache: AliasDefinition[];
    private static aliasCacheLength: number;

    private static tagData: TagData = {};           // stores tag data for the session - count, valid, dnp, etc
    private static tagAliases: TagAlias = {};       // stores e621's alias pairs to avoid repeated lookups

    private static postPageLockout = false;         // Used to avoid calling the API on every post page

    public constructor() {
        super({
            constraint: [PageDefinition.upload, PageDefinition.post, PageDefinition.search, PageDefinition.favorites],
            waitForFocus: true,
        });
    }

    public Settings = {
        enabled: true,

        autoLoad: true,
        tagOrder: TagOrder.Default,

        quickTagsForm: true,
        editTagsForm: true,
        searchForm: true,

        uploadCharactersForm: true,
        uploadSexesForm: true,
        uploadBodyTypesForm: true,
        uploadThemesForm: true,
        uploadTagsForm: true,

        replaceAliasedTags: true,
        replaceLastTag: false,
        fixCommonTypos: false,
        asciiWarning: true,
        minPostsWarning: 20,
        compactOutput: false,

        minCachedTags: 1000,

        data: "",
    };

    public async prepare(): Promise<void> {
        await super.prepare();

        if (!Page.matches(PageDefinition.post)) return;

        // Only create an instance once the editing form is enabled
        // This will avoid unnecessary API calls, as well as solve issues with dynamic DOM
        if (!$("#post_tag_string").is(":visible")) {

            // This is dumb, but it works
            // If the editing form is visible when the script loads, skip this whole thing
            // This fixes an issue with SmartAlias not loading if the editing form is opened before page loads

            SmartAlias.postPageLockout = true;
            $("body").one("click.re621", "#post-edit-link, #side-edit-link", () => {
                SmartAlias.postPageLockout = false;
                this.reload();
            });
        }
    }

    public async create(): Promise<void> {
        super.create();

        if (this.Settings.searchForm && Page.matches([PageDefinition.search, PageDefinition.post, PageDefinition.favorites])) {
            this.handleSearchForm();
        }

        // Abort the whole thing if the quick tags form is disabled in settings
        if (!this.Settings.quickTagsForm && Page.matches([PageDefinition.search, PageDefinition.favorites]))
            return;

        // Abort execution on the post page if it's disabled anyways
        if (!this.Settings.quickTagsForm && Page.matches(PageDefinition.post))
            return;

        // Toggle the data-attribute necessary for the compact form
        this.setCompactOutput(this.Settings.compactOutput);

        // Only create the structure once the editing form is enabled
        if (SmartAlias.postPageLockout) return;

        // Establish the data caches
        if (typeof SmartAlias.aliasCache == "undefined") {
            const cacheData = this.Settings.data;
            SmartAlias.aliasCache = SmartAlias.getAliasData(cacheData);
            SmartAlias.aliasCacheLength = cacheData.length;
        }

        // Fix the secret switch breaking the module
        $(".the_secret_switch").one("click", () => { this.reload(); });

        // Detect enabled inputs
        const inputs = new Set(Array.from(SmartAlias.inputSelector));
        if (!this.Settings.uploadCharactersForm) inputs.delete("#post_characters");
        if (!this.Settings.uploadSexesForm) inputs.delete("#post_sexes");
        if (!this.Settings.uploadBodyTypesForm) inputs.delete("#post_bodyTypes");
        if (!this.Settings.uploadThemesForm) inputs.delete("#post_themes");
        if (!this.Settings.uploadTagsForm) inputs.delete("#post_tags");

        this.inputElements = [];

        // Initializes SmartAlias for all appropriate inputs
        const mode = this.Settings.autoLoad;
        for (const inputElement of $([...inputs].join(", ")).get()) {
            const $textarea = $(inputElement);

            // Ignore already initialized inputs
            if ($textarea.data("re621:smartalias")) continue;
            $textarea.data("re621:smartalias", true);

            this.inputElements.push($textarea);
            const $container = $("<smart-alias>")
                .attr("ready", "true")
                .insertAfter($textarea);
            const $counter = $("<smart-tag-counter>")
                .insertAfter($textarea);

            if (mode) this.manageAutoLoad($textarea, $container);
            else this.manageManualLoad($textarea, $container)

            // On search pages, in the editing mode, reload container when the user clicks on a thumbnail
            // Otherwise, the old tags get left behind. Thanks to tag data caching, this should be pretty quick
            if (Page.matches([PageDefinition.search, PageDefinition.favorites])) {
                $("article.post-preview").on("click.danbooru", () => {
                    if (mode) this.handleTagInput($textarea, $container, false);
                    else $container.html("");
                });
            }

            // Update the tag counter
            let updateTimeout: number;
            $textarea.on("input re621:input", () => {
                if (updateTimeout) return;
                updateTimeout = window.setTimeout(() => { updateTimeout = 0; }, 500);
                $counter.html(SmartAlias.countTagInput($textarea) + "");
            });
        }

        // Listen for settings changes
        this.on("settings", () => {
            this.reload(100);
        });
    }

    public async destroy(): Promise<void> {
        for (const inputElement of $("#post_tags, #post_tag_string").get()) {
            $(inputElement)
                .off("focus.re621.smart-alias")
                .off("focusout.re621.smart-alias");
        }
        $("smart-alias").remove();
        $("smart-tag-counter").remove();
        $("button.smart-alias-validate").remove();
        $("#tags").off("input.re621.smart-alias");

        for (const element of this.inputElements)
            element
                .off("input.smartalias blur.smartalias blur.smartalias.spacefix")
                .removeData("re621:smartalias");
    }

    /**
     * Parses the textarea input specified in the parameter and returns a list of space-separated tags
     * @param input Textarea to parse
     */
    private static getInputString(input: JQuery<HTMLElement>): string {
        return input.val().toString().trim()
            .toLowerCase()
            .replace(/\r?\n|\r/g, " ")      // strip newlines
            .replace(/(?:\s){2,}/g, " ");    // strip multiple spaces
    }

    /**
     * Parses the string input specified in the parameter and returns an array of tags
     * @param input Space-separated sting of tags
     */
    private static parseTagString(input: string): ParsedTag[] {
        const result = [];
        for (const tag of input.split(/ |\n|\r/).filter(el => el != null && el != ""))
            result.push(ParsedTag.fromString(tag));
        return result;
    }

    /**
     * Parses the textarea input specified in the parameter and returns an array of tags
     * @param input Textarea to parse
     */
    private static parseTagInput(input: JQuery<HTMLElement>): ParsedTag[] {
        return this.parseTagString(SmartAlias.getInputString(input));
    }

    private static countTagInput(input: JQuery<HTMLElement>): number {
        return SmartAlias.getInputString(input).split(/ |\n|\r/).length;
    }

    private manageAutoLoad($textarea: JQuery<HTMLElement>, $container: JQuery<HTMLElement>): void {

        // Wait for the user to stop typing before processing
        let typingTimeout: number;
        $textarea
            .on("input.smartalias blur.smartalias", () => {

                // handleTagInput triggers an input event to properly fill in the data bindings
                // this ensures that it will not result in an infinite loop
                if ($textarea.data("vue-event") === "true") {
                    $textarea.data("vue-event", "false");
                    return;
                }

                // If the data is currently processing, but the user keeps typing,
                // check every second to make sure the last input is caught
                window.clearInterval(typingTimeout);
                typingTimeout = window.setInterval(() => {
                    if ($container.attr("ready") !== "true") return;

                    window.clearInterval(typingTimeout);
                    this.handleTagInput($textarea, $container);
                }, 1000);
            })
            .on("blur.smartalias.spacefix", () => {
                $textarea.val((index, value) => {
                    return (value.endsWith(" ") || value.length == 0) ? value : (value + " ");
                })
            });

        // Skip the waiting and go straight to parsing
        $textarea.on("re621:input", () => {
            this.handleTagInput($textarea, $container);
        });

        // First call, in case the input area is not blank
        // i.e. on post page, or in editing mode
        this.handleTagInput($textarea, $container, false);
    }

    private manageManualLoad($textarea: JQuery<HTMLElement>, $container: JQuery<HTMLElement>): void {

        $("<button>")
            .html("Validate")
            .addClass("smart-alias-validate")
            .insertBefore($container)
            .on("click", (event) => {
                event.preventDefault();
                this.handleTagInput($textarea, $container, false);
            });

    }

    /**
     * Process the tag string in the textarea, and display appropriate data in the container
     * @param $textarea Textarea to process
     * @param $container Display container
     * @param scrollToBottom If true, the container's viewport will scroll to the very bottom once processed
     */
    private async handleTagInput($textarea: JQuery<HTMLElement>, $container: JQuery<HTMLElement>, scrollToBottom = true): Promise<void> {
        if ($container.attr("ready") !== "true") return;
        $container.attr("ready", "false");

        // Fix typos
        // TODO Replace this with better error handling
        if (this.Settings.fixCommonTypos) {
            $textarea.val((index, currentValue) => {
                return (currentValue.toLowerCase());
            });
        }

        // Pass on the original tags, if necessary
        const originalTags = $textarea.data("originalTags");
        if (originalTags) {
            $container.attr("has-original", "true");
            $container.data("originalTags", originalTags);
        } else $container.removeAttr("has-original");

        // Get the tags from the textarea
        const inputString = SmartAlias.getInputString($textarea);
        let tags: ParsedTag[] = SmartAlias.parseTagString(inputString);

        // Skip the rest if the textarea is empty
        if (tags.length == 0) {
            $container.html("");
            $container.attr("ready", "true");
            return;
        }

        // Get the settings
        const minPostsWarning = this.Settings.minPostsWarning,
            asciiWarning = this.Settings.asciiWarning,
            tagOrder = this.Settings.tagOrder;


        // Step 1
        // Replace custom aliases with their contents
        // This is probably overcomplicated to all hell
        await this.loadAliasCache();

        if (SmartAlias.aliasCache.length > 0) {
            $textarea.val((index, text) => {
                return this.replaceInputAliases(text);
            });

            // Regenerate the tags to account for replacements
            triggerUpdateEvent($textarea);
            tags = SmartAlias.parseTagInput($textarea);
        }


        // Step 2
        // Create a list of tags that need to be looked up in the API
        // Ignore tags considered malformed from the very start
        const lookup: Set<string> = new Set();
        for (const tagData of tags.filter(tag => !tag.malformed)) {
            if (typeof SmartAlias.tagData[tagData.name] == "undefined")
                lookup.add(tagData.name);
        }

        // Redraw the container to indicate loading
        redrawContainerContents($container, tags, minPostsWarning, asciiWarning, tagOrder, lookup);


        // Step 3
        // Check the lookup tags for aliases
        const invalidTags: Set<string> = new Set(),
            ambiguousTags: Set<string> = new Set();
        for (const batch of Util.chunkArray([...lookup].filter((value) => SmartAlias.tagAliases[value] == undefined), 40)) {
            for (const result of (await RE621.API.TagAliases.find({ antecedent_name: batch as any, limit: 320 })).data) {

                // Don't apply pending or inactive aliases
                if (result.status !== "active") continue;

                const currentName = result.antecedent_name,
                    trueName = result.consequent_name;

                // Don't replace tags aliased to `invalid_tag`
                if (trueName == "invalid_tag" || trueName == "invalid_color") {
                    invalidTags.add(currentName);
                    continue;
                }

                // Account for ambiguous tags
                if (trueName.endsWith("_(disambiguation)")) {
                    ambiguousTags.add(currentName);
                    // TODO make record of tags that implicate an ambiguous tag, and display them
                    continue;
                }

                // Don't look up tags that have been found already
                lookup.delete(currentName);
                if (SmartAlias.tagData[trueName] == undefined)
                    lookup.add(trueName);

                // Mark down the alias name to be replaced
                SmartAlias.tagAliases[currentName] = trueName;

            }
        }


        // Step 4
        // Replace all known e6 aliases with their consequent versions to avoid unnecessary API calls
        if (this.Settings.replaceAliasedTags) {
            // console.log(SmartAlias.tagAliases);
            $textarea.val((index, currentValue) => {
                const lastTag = (this.Settings.replaceLastTag || currentValue.endsWith(" ") || !$textarea.is(":focus"))
                    ? null
                    : Util.getTags($textarea).pop();
                // console.log("[" + lastTag + "]", this.fetchSettings("replaceLastTag"), $textarea.is(":focus"));
                for (const [antecedent, consequent] of Object.entries(SmartAlias.tagAliases)) {
                    if (antecedent == lastTag) continue;
                    // console.log("replacing [" + antecedent + "] with [" + consequent + "]", antecedent == lastTag);
                    currentValue = currentValue.replace(
                        this.getTagRegex(antecedent),
                        "$1" + consequent + "$3"
                    );
                }

                return currentValue;
            });

            // Regenerate the tags to account for replacements
            triggerUpdateEvent($textarea);
            tags = SmartAlias.parseTagInput($textarea);
        }


        // Step 4.5
        // Check the tags against the cache
        TagCache.load();
        for (const tag of lookup) {
            const data = TagCache.get(tag);
            if (data == null) continue;

            SmartAlias.tagData[tag] = {
                count: data.count,
                category: data.category,

                ambiguous: false,
                invalid: false,
                dnp: AvoidPosting.has(tag),
                errors: TagValidator.runVerbose(tag),

                cached: true,
            };
            lookup.delete(tag);
        }


        // Step 5
        // Look up the tags through the API to make sure they exist
        // Those that do not get removed from the list must be invalid
        if (lookup.size > 0) {

            for (const batch of Util.chunkArray(lookup, 100)) {
                for (const result of (await RE621.API.Tags.find({
                    name: batch,
                    hide_empty: false,
                    limit: 100,
                })).data) {
                    SmartAlias.tagData[result.name] = {
                        count: result.post_count,
                        category: result.category,

                        ambiguous: ambiguousTags.has(result.name),
                        invalid: invalidTags.has(result.name),
                        dnp: AvoidPosting.has(result.name),
                        errors: TagValidator.runVerbose(result.name),

                        cached: false,
                    };
                    lookup.delete(result.name);
                }
            }

            for (const tagName of lookup) {
                SmartAlias.tagData[tagName] = {
                    count: -1,
                    category: TagCategory.Unknown,

                    ambiguous: false,
                    invalid: true,
                    dnp: AvoidPosting.has(tagName),
                    errors: TagValidator.runVerbose(tagName),

                    cached: false,
                };
            }

        }


        // Step 5.5
        // Add data to cache
        const minCachedTags = this.Settings.minCachedTags;
        if (minCachedTags > 0) {
            for (const [name, data] of Object.entries(SmartAlias.tagData)) {
                if (TagCache.has(name) || data.count < minCachedTags) continue;
                TagCache.add(name, data.count, data.category);
            }
            TagCache.save();
        }


        // Step 6
        // Redraw the tag data output container
        // console.log("data", SmartAlias.tagData);
        redrawContainerContents($container, tags, minPostsWarning, asciiWarning, tagOrder);


        // Step 7
        // Finish and clean up
        if (scrollToBottom)
            $container.scrollTop($container[0].scrollHeight - $container[0].clientHeight);
        $container.attr("ready", "true");


        /**
         * Fix for Vue data-attribute binding  
         * This needs to be executed every time the textarea value gets changed
         * @param $textarea Textarea input
         */
        function triggerUpdateEvent($textarea: JQuery<HTMLElement>): void {
            Util.Events.triggerVueEvent($textarea, "input", "vue-event");
        }

        /**
         * Clears and redraws the information display container
         * @param $container Container to refresh
         * @param tags Tags to display
         * @param loading Tags to mark as loading
         */
        function redrawContainerContents($container: JQuery<HTMLElement>, tags: ParsedTag[], minPostsWarning: number, asciiWarning: boolean, tagOrder: TagOrder, loading = new Set<string>()): void {
            $container
                .html("")
                .toggleClass("grouped", tagOrder == TagOrder.Grouped);

            const originalTags: Set<string> = $container.data("originalTags")
                ? $container.data("originalTags")
                : new Set();

            if (tagOrder !== TagOrder.Default)
                tags = tags.sort((a, b) => a.name.localeCompare(b.name));

            // console.log(SmartAlias.tagData);

            // Index of tag names, for quicker duplicated checking
            const tagNames = [];
            for (const tagData of tags)
                tagNames.push(tagData.name);

            for (const tagData of tags) {

                let displayName = tagData.name;  // text to be displayed in the link
                if (SmartAlias.tagAliases[tagData.name] != undefined)
                    tagData.name = SmartAlias.tagAliases[tagData.name];

                const data = tagData.malformed
                    ? {
                        count: 0,
                        category: TagCategory.Invalid,

                        invalid: true,
                        ambiguous: false,
                        dnp: false,
                        errors: [],

                        cached: false,
                    }
                    : SmartAlias.tagData[tagData.name];
                const isLoading = loading.has(tagData.name);

                // console.log("drawing " + tagName, data);

                // Tags that are currently loading will not have the necessary data.
                // For all other tags, lacking data means that an error has occurred
                if (data == undefined && !isLoading) continue;

                let symbol: string,         // font-awesome icon in front of the line
                    color: string,          // color of the non-link text
                    text: string,           // text after the link
                    title: string;

                if (isLoading) {
                    symbol = "loading";
                    color = "success";
                    text = "";
                } else if (tagData.malformed) {
                    symbol = "error";
                    color = "error";
                    text = "invalid";
                    tagData.name = (tagData.negated ? "-" : "") + (tagData.prefix ? (tagData.prefix + ":") : "") + tagData.name;
                    displayName = tagData.name;
                } else if (data.dnp) {
                    symbol = "error";
                    color = "error";
                    text = "avoid posting";
                } else if (Util.getArrayIndexes(tagNames, tagData.name).length > 1) {
                    symbol = "info";
                    color = "info";
                    text = "duplicate";
                } else if (data.invalid || data.category == TagCategory.Invalid) {
                    symbol = "error";
                    color = "error";
                    text = "invalid";
                } else if (data.ambiguous || tagData.name.endsWith("_(disambiguation)")) {
                    symbol = "info";
                    color = "warning";
                    text = "ambiguous";
                    displayName = displayName.replace("_(disambiguation)", "");
                } else if (data.count == 0) {
                    symbol = "error";
                    color = "error";
                    text = "empty";
                } else if (data.count < minPostsWarning) {
                    symbol = "error";
                    color = "error";
                    text = data.count + "";
                } else {
                    symbol = "success";
                    color = "success";
                    text = data.cached ? "~" + Util.formatK(data.count) : data.count + "";
                    title = data.cached ? "cached value" : undefined;
                }

                // Insert zero-width spaces for better line-breaking
                displayName = displayName.replace(/_/g, "_&#8203;");

                let action = "default";
                if (originalTags.has(tagData.name) && tagData.negated) action = "removed";
                if (!originalTags.has(tagData.name) && !tagData.negated) action = "added";

                $("<smart-tag>")
                    .addClass(isLoading ? "" : "category-" + data.category)
                    .attr({
                        "name": tagData.name,
                        "symbol": symbol,
                        "color": color,
                        // "title": title,
                        "action": action == "default" ? undefined : action,
                    })
                    .html(
                        `<a href="/wiki_pages/show_or_new?title=${encodeURIComponent(tagData.name)}" target="_blank" rel="noopener noreferrer" tabindex="-1">${displayName}</a>
                        <span title="${title}">${text}</span>`
                        + (
                            (asciiWarning && data && data.errors.length > 0 && !data.dnp)
                                ? ` <span class="fas fa-exclamation-triangle tag-warning" title="${data.errors.join("\n")}"></span>`
                                : ``
                        )
                    )
                    .appendTo($container);
            }
        }

    }

    /** Loads the alias cache from the settings */
    private async loadAliasCache(): Promise<void> {
        const aliasCacheRaw = this.Settings.data;
        if (aliasCacheRaw.length !== SmartAlias.aliasCacheLength) {
            SmartAlias.aliasCache = SmartAlias.getAliasData(aliasCacheRaw);
            SmartAlias.aliasCacheLength = aliasCacheRaw.length;
        }
    }

    /**
     * Processes the raw text value of the custom alias field and converts it into machine-readable format.  
     * TODO Optimize this as much as possible
     * @param rawData Raw plaintext data
     */
    public static getAliasData(rawData: string): AliasDefinition[] {
        const data = rawData.split("\n").reverse();
        const result: AliasDefinition[] = [];

        const aliasList = new Set<string>();

        for (const line of data) {
            const parts = line
                .split("#")[0]
                .trim()
                .split("->");

            if (parts.length !== 2) continue;

            const def: AliasDefinition = {
                lookup: new Set(),
                output: formatOutput(parts[1]),
            }

            // This should prevent multiple aliases from being called by the same lookup
            // Only the last one in the file would be counted.
            // If an alias has no lookups, it is discarded
            for (const part of formatLookup(parts[0])) {
                if (aliasList.has(part)) continue;
                aliasList.add(part);
                def.lookup.add(part);
            }

            if (def.lookup.size == 0) continue;

            result.push(def);
        }

        return result;

        function formatLookup(input: string): Set<string> {
            return new Set(
                input
                    .split(" ")
                    .filter((e) => e != "")
            );
        }

        function formatOutput(input: string): string {
            return input
                .trim()
                .replace(/\s{2,}/g, " ");
        }
    }

    /**
     * Dynamically creates a regex that should find individual in the textarea
     * @param input Input, as a single string, an array, or a set
     */
    private getTagRegex(input: string | string[] | Set<string>): RegExp {
        if (typeof input == "string") input = [input];
        else input = [...input];

        for (let i = 0; i < input.length; i++)
            input[i] = input[i]
                .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
                .replace(/\*/g, "(\\S*)");
        return new RegExp("((?:^|\n| )-?(?:(?:artist|character|copyright|species):)?)(" + input.join("|") + ")( |\n|$)", "gi");
    }

    /**
     * Replaces the custom aliases with their consequent values.  
     * Note that an alias cache must be built beforehand via `loadAliasCache()`
     * @param text Text to parse
     */
    private replaceInputAliases(text: string): string {

        // Run the the process as many times as needed until no more changes can be made
        // This should take care of nested aliases while preventing infinite recursion
        let changes = 0,
            iterations = 0;
        do {
            changes = 0;
            for (const aliasDef of SmartAlias.aliasCache) {

                text = text.replace(
                    this.getTagRegex(aliasDef.lookup),
                    (...args) => {  // match, prefix, body, suffix1, suffix2, etc
                        changes++;

                        // Replace the wildcards in the output with values
                        // Starts at fourth position to skip match, prefix, and alias body
                        // Ends 2 positions before the end to skip number of hits and full string
                        let output = aliasDef.output;
                        for (let i = 3; i < args.length - 3; i++)
                            output = output.replace(new RegExp("\\$" + (i - 2), "gi"), args[i]);

                        // Prevent duplicate tags from being added by aliases
                        const result = new Set<string>();
                        for (const part of output.split(" ")) {
                            if (this.getTagRegex(part).test(text)) continue;
                            result.add(part);
                        }

                        if (result.size == 0) return " ";
                        return args[1] + [...result].join(" ") + args[args.length - 3];
                    }
                );

            }
            iterations++;
        } while (changes != 0 && iterations < SmartAlias.ITERATIONS_LIMIT);

        return text;
    }

    /** Handles alias replacement in the search form */
    private handleSearchForm(): void {
        let typingTimeout: number;
        const input = $("#tags").on("input.re621.smart-alias", () => {
            clearTimeout(typingTimeout);
            typingTimeout = window.setTimeout(async () => {
                await this.loadAliasCache();
                input.val((index, text) => {
                    return this.replaceInputAliases(text);
                });
            }, 500);
        });
    }

    /**
     * Toggles the compact form styles
     * @param state True for compact, false for expanded
     */
    public setCompactOutput(state = false): void {
        $("#page").attr("data-smartalias-compact", state + "");
    }

}

interface AliasDefinition {
    lookup: Set<string>;
    output: string;
}

interface TagData {
    [name: string]: Tag;
}

interface Tag {
    count: number;
    category: TagCategory;

    invalid: boolean;
    ambiguous: boolean;
    dnp: boolean;
    errors: string[];

    cached: boolean;
}

interface TagAlias {
    [name: string]: string;
}

enum TagOrder {
    Default = "default",
    Alphabetical = "alphabetical",
    Grouped = "grouped",
}

namespace TagOrder {

    export function fromString(input: string): TagOrder {
        for (const value of Object.values(TagOrder))
            if (value == input) return value;
        return TagOrder.Default;
    }

}

type ParsedTag = {
    name: string;
    negated: boolean;
    prefix: string;
    malformed?: boolean;
}

namespace ParsedTag {
    export function fromString(rawTag: string): ParsedTag {
        const result: ParsedTag = {
            name: null,
            negated: false,
            prefix: null,
        }

        if (rawTag.startsWith("-")) {
            result.negated = true;
            rawTag = rawTag.substr(1);
        }

        const match = rawTag.match(/(artist|character|copyright|species):/)
        if (match) {
            result.prefix = match[1];
            rawTag = rawTag.substr(match[0].length);
        }

        result.name = rawTag;

        if (result.name.length == 0)
            result.malformed = true;

        return result;
    }

    export function toString(tag: ParsedTag, skipNegation = false): string {
        return ((tag.negated && !skipNegation) ? "-" : "")
            + (tag.prefix ? (tag.prefix + ":") : "")
            + tag.name;
    }
}
