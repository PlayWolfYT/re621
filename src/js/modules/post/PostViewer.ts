import { Danbooru } from "../../components/api/Danbooru";
import { PageDefintion } from "../../components/data/Page";
import { Post, ViewingPost } from "../../components/data/Post";
import { ModuleController } from "../../components/ModuleController";
import { RE6Module, Settings } from "../../components/RE6Module";
import { ThumbnailEnhancer } from "../search/ThumbnailsEnhancer";

/**
 * Add various symbols to the tilebar depending on the posts state
 */
export class PostViewer extends RE6Module {

    private post: ViewingPost;

    public constructor() {
        super(PageDefintion.post, true);
        this.registerHotkeys(
            { keys: "hotkeyUpvote", fnct: this.triggerUpvote },
            { keys: "hotkeyDownvote", fnct: this.triggerDownvote },

            { keys: "hotkeyFavorite", fnct: this.toggleFavorite },
            { keys: "hotkeyAddFavorite", fnct: this.addFavorite },
            { keys: "hotkeyRemoveFavorite", fnct: this.removeFavorite },

            { keys: "hotkeyHideNotes", fnct: this.toggleNotes },
            { keys: "hotkeyNewNote", fnct: this.switchNewNote },

            { keys: "hotkeyAddSet", fnct: this.addSet },
            { keys: "hotkeyAddPool", fnct: this.addPool },
        );
    }

    /**
     * Returns a set of default settings values
     * @returns Default settings
     */
    protected getDefaultSettings(): Settings {
        return {
            enabled: true,
            hotkeyUpvote: "w",
            hotkeyDownvote: "s",

            hotkeyFavorite: "f",
            hotkeyAddFavorite: "",
            hotkeyRemoveFavorite: "",

            hotkeyHideNotes: "o",
            hotkeyNewNote: "p",

            hotkeyAddSet: "",
            hotkeyAddPool: "",

            upvoteOnFavorite: true,
            hideNotes: false,
        };
    }

    /**
     * Creates the module's structure.  
     * Should be run immediately after the constructor finishes.
     */
    public create(): void {
        super.create();

        this.post = Post.getViewingPost();

        // Move the add to set / pool buttons
        const $addToContainer = $("<div>").attr("id", "image-add-links").insertAfter("div#image-download-link");
        $("li#add-to-set-list > a")
            .addClass("image-add-set")
            .addClass("button btn-neutral")
            .html("+ Set")
            .appendTo($addToContainer);
        $("li#add-to-pool-list > a")
            .addClass("image-add-pool")
            .addClass("button btn-neutral")
            .html("+ Pool")
            .appendTo($addToContainer);

        // Create the Note Toggle button
        const $noteToggleCountainer = $("<div>").attr("id", "image-toggle-notes").insertAfter("div#image-add-links");
        $("<a>")
            .attr({
                "id": "image-note-button",
                "href": "#",
            })
            .addClass("button btn-neutral")
            .html(this.fetchSettings("hideNotes") ? "Notes: Off" : "Notes: On")
            .appendTo($noteToggleCountainer)
            .on("click", (event) => {
                event.preventDefault();
                this.toggleNotes();
            });
        $("div#note-container")
            .css("display", "")
            .attr("data-hidden", this.fetchSettings("hideNotes"));

        // Move child/parent indicator, leave others as is, like marked for deleteion
        const $bottomNotices = $(".parent-children");
        $bottomNotices.insertAfter($("#search-box"));

        // Listen to favorites button click
        $("#add-fav-button").on("click", () => {
            console.log("click1");
            if (this.fetchSettings("upvoteOnFavorite"))
                Danbooru.Post.vote(Post.getViewingPost().getId(), 1, true);

            ThumbnailEnhancer.trigger("favorite", { id: this.post.getId(), action: true });
        });

        $("#remove-fav-button").on("click", () => {
            console.log("click2");
            ThumbnailEnhancer.trigger("favorite", { id: this.post.getId(), action: false });
        });
    }

    /** Emulates a click on the upvote button */
    private triggerUpvote(): void {
        Danbooru.Post.vote(Post.getViewingPost().getId(), 1);
    }

    /** Emulates a click on the downvote button */
    private triggerDownvote(): void {
        Danbooru.Post.vote(Post.getViewingPost().getId(), -1);
    }

    /** Toggles the favorite state */
    private toggleFavorite(): void {
        if ($("div.fav-buttons").hasClass("fav-buttons-false")) { $("button#add-fav-button")[0].click(); }
        else { $("button#remove-fav-button")[0].click(); }
    }

    /** Adds the post to favorites, does not remove it */
    private addFavorite(): void {
        if ($("div.fav-buttons").hasClass("fav-buttons-false")) {
            $("button#add-fav-button")[0].click();
        }
    }

    /** Removes the post from favorites, does not add it */
    private removeFavorite(): void {
        if (!$("div.fav-buttons").hasClass("fav-buttons-false")) {
            $("button#remove-fav-button")[0].click();
        }
    }

    /** Switches the notes container to its opposite state */
    private async toggleNotes(): Promise<void> {
        const module = ModuleController.get(PostViewer),
            hideNotes = module.fetchSettings("hideNotes");

        if (hideNotes) {
            $("div#note-container").attr("data-hidden", "false");
            $("a#image-note-button").html("Notes: ON");
        } else {
            $("div#note-container").attr("data-hidden", "true");
            $("a#image-note-button").html("Notes: OFF");
        }

        await module.pushSettings("hideNotes", !hideNotes);
    }

    /** Toggles the note editing interface */
    private async switchNewNote(): Promise<void> {
        $("div#note-container").attr("data-hidden", "false");
        $("a#image-note-button").html("Notes: ON");
        await ModuleController.get(PostViewer).pushSettings("hideNotes", false);

        Danbooru.Note.TranslationMode.toggle(new Event("re621.dummy-event"));
    }

    /** Opens the dialog to add the post to the set */
    private addSet(): void {
        $("a#set")[0].click();

    }

    /** Opens the dialog to add the post to the pool */
    private addPool(): void {
        $("a#pool")[0].click();
    }

}
