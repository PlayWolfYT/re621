import RE621 from "../../../RE621";
import ErrorHandler from "../../old.components/utility/ErrorHandler";
import LocalStorage from "../api/LocalStorage";
import Post from "./Post";
import PostFilter, { FilterOptions } from "./PostFilter";
import User from "./User";

export default class Blacklist {

    private static instance: Blacklist;

    private blacklist = new Map<string, PostFilter>();

    private constructor() {
        const blacklistMeta = $("head meta[name=blacklisted-tags]");
        if (!blacklistMeta.length) {
            console.warn("Warning: The blacklist failed to load. This may be caused by the blacklist being empty, or by an internal error.");
            return;
        }

        const BlacklistEnhancer = RE621.Registry.BlacklistUI;
        const options: FilterOptions = {
            favorites: BlacklistEnhancer.Settings.favorites,
            uploads: BlacklistEnhancer.Settings.uploads,
            whitelist: BlacklistEnhancer.Settings.whitelist,
        };

        const rawBlacklistData = blacklistMeta.attr("content");
        if (typeof rawBlacklistData == "undefined") return;
        let blacklistData: string[];
        try { blacklistData = JSON.parse(rawBlacklistData); }
        catch (error) {
            ErrorHandler.write("Error while parsing the blacklist data", error);
            return;
        }

        const allDisabled = LocalStorage.Blacklist.AllDisabled;
        const disabledTags = LocalStorage.Blacklist.TagsDisabled;

        for (let tags of blacklistData.filter(n => n)) {

            // Skip empty or broken values
            tags = tags ? tags.trim() : "";
            if (!tags) continue;

            // Create a blacklist filter
            this.createFilter(tags, (!allDisabled && !disabledTags.includes(tags)), options);
        }
    }

    /** Returns a singleton instance of the class */
    private static getInstance(): Blacklist {
        if (this.instance == undefined) this.instance = new Blacklist();
        return this.instance;
    }

    /**
     * Returns the parsed blacklist filters
     * @returns PostFilter[] A array of the users current filters
     */
    private static get(): Map<string, PostFilter> {
        return this.getInstance().blacklist;
    }

    /** Returns the filters that currently have posts on record */
    public static getActiveFilters(): Map<string, PostFilter> {
        const result: Map<string, PostFilter> = new Map();
        for (const [tags, filter] of this.getInstance().blacklist)
            if (filter.getMatchesCount() > 0) result.set(tags, filter);
        return result;
    }

    /**
     * Adds the post to the blacklist cache
     * @param posts Post(s) to add to the cache
     * @returns Number of filters that match the post
     */
    public static addPost(...posts: Post[]): number {
        let count = 0;
        for (const filter of Blacklist.get().values()) {
            if (filter.update(posts)) count++;
        }
        return count;
    }

    /**
     * Alias of `addPost`, to avoid ambiguity
     * @param posts Post(s) to update
     * @returns Number of filters that match the post
     */
    public static updatePost(...posts: Post[]): number {
        return Blacklist.addPost(...posts);
    }

    /** Returns true if the post is in the blacklist cache */
    public static checkPost(post: Post | number, ignoreDisabled = false): boolean {
        if (typeof post !== "number") post = post.id;
        for (const filter of Blacklist.get().values()) {
            if (filter.matchesID(post, ignoreDisabled)) return true;
        }
        return false;
    }

    /**
     * Alternative approach to `checkPost` method.  
     * Returns:
     * - 0 if no filters match the post
     * - 1 if at least one enabled filter matches
     * - 2 if any number of filters match, but are all disabled
     * @param post Post to test against the filter
     */
    public static checkPostAlt(post: Post | number): PostVisibility {
        if (typeof post !== "number") post = post.id;
        let resultType = PostVisibility.Full;
        for (const filter of Blacklist.get().values()) {
            const result = filter.matchesIDAlt(post);
            if (result) {
                if (result == 1) return PostVisibility.None;
                else resultType = PostVisibility.Some;
            }
        }
        return resultType;
    }

    /** Enables all blacklist filters */
    public static enableAll(): void {
        for (const filter of Blacklist.get().values())
            filter.setEnabled(true);
    }

    /** Disables all blacklist filters */
    public static disableAll(): void {
        for (const filter of Blacklist.get().values())
            filter.setEnabled(false);
    }

    /** Returns true if all active filters are enabled */
    public static allEnabled(): boolean {
        for (const filter of this.getActiveFilters().values())
            if (!filter.isEnabled()) return false;
        return true;
    }

    /** Returns true if all active filters are enabled */
    public static allDisabled(): boolean {
        for (const filter of this.getActiveFilters().values())
            if (filter.isEnabled()) return false;
        return true;
    }

    /**
     * Creates a new filter based on provided tag string
     * @param filter String which should be turned into a PostFilter
     * @param enabled Whether or not the filter should be enabled after creation
     */
    private createFilter(filter: string, enabled = true, options?: FilterOptions): void {

        // Ensure that the filter is not blank
        if (!filter) return;

        // If the filter does not exit yet, create it
        let postFilter = this.blacklist.get(filter);
        if (postFilter === undefined) {
            postFilter = new PostFilter(filter, enabled, options);
            this.blacklist.set(filter, postFilter);
        }
    }

    /**
     * Creates a new filter based on provided tag string
     * @param filter String which should be turned into a PostFilter
     * @param enabled Whether or not the filter should be enabled after creation
     */
    public static createFilter(filter: string, enabled = true, options?: FilterOptions): void {
        return this.getInstance().createFilter(filter, enabled, options);
    }

    /**
     * Deletes the filter matching provided tag string
     * @param filter String which should match an existing PostFilter
     */
    private deleteFilter(filter: string): void {
        this.blacklist.delete(filter);
    }

    /**
     * Deletes the filter matching provided tag string
     * @param filter String which should match an existing PostFilter
     */
    public static deleteFilter(filter: string): void {
        return this.getInstance().deleteFilter(filter);
    }

    /**
     * Adds or removes a tag from the user's blacklist
     * @param tagname Name of the tag to toggle
     */
    public static async toggleBlacklistTag(tagName: string): Promise<void> {

        let currentBlacklist = (await User.getCurrentSettings()).blacklisted_tags.split("\n");

        if (currentBlacklist.indexOf(tagName) === -1) {
            currentBlacklist.push(tagName);
            Blacklist.createFilter(tagName);
            Danbooru.notice(`Adding ${getTagLink(tagName)} to blacklist`);
        } else {
            currentBlacklist = currentBlacklist.filter(e => e !== tagName);
            Blacklist.deleteFilter(tagName);
            Danbooru.notice(`Removing ${getTagLink(tagName)} from blacklist`);
        }

        await User.setSettings({ blacklisted_tags: currentBlacklist.join("\n") });

        // BlacklistEnhancer.update(); // TODO What if not initialized?
        // Post.find("all").each((post) => { post.updateVisibility(); });

        return Promise.resolve();

        function getTagLink(tagName: string): string {
            if (tagName.startsWith("id:")) return `<a href="/posts/${tagName.substr(3)}" target="_blank" rel="noopener noreferrer">${tagName}</a>`;
            return `<a href="/wiki_pages/show_or_new?title=${tagName}">${tagName}</a>`;
        }
    }

}

/*
     * - 0 if no filters match the post
     * - 1 if at least one enabled filter matches
     * - 2 if any number of filters match, but are all disabled
 */
export enum PostVisibility {
    Full = 0,
    None = 1,
    Some = 2,
}
