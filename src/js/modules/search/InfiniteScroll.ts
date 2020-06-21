import { Danbooru } from "../../components/api/Danbooru";
import { E621 } from "../../components/api/E621";
import { PostHtml } from "../../components/api/PostHtml";
import { APIPost } from "../../components/api/responses/APIPost";
import { Page, PageDefintion } from "../../components/data/Page";
import { Post } from "../../components/data/Post";
import { ModuleController } from "../../components/ModuleController";
import { RE6Module, Settings } from "../../components/RE6Module";
import { BlacklistEnhancer } from "./BlacklistEnhancer";
import { CustomFlagger, FlagDefinition } from "./CustomFlagger";
import { InstantSearch } from "./InstantSearch";
import { ThumbnailClickAction, ThumbnailEnhancer, ThumbnailPerformanceMode } from "./ThumbnailsEnhancer";

/**
 * Gets rid of the default pagination and instead appends new posts
 * when you scrolled to the bottom
 */
export class InfiniteScroll extends RE6Module {

    private $postContainer: JQuery<HTMLElement>;
    private $loadingIndicator: JQuery<HTMLElement>;
    private $nextButton: JQuery<HTMLElement>;
    private currentQuery: string;

    private currentPage: number;
    private isInProgress: boolean;
    private pagesLeft: boolean;

    private scrollPaused = false;

    public constructor() {
        super(PageDefintion.search);
    }

    /**
     * Returns a set of default settings values
     * @returns Default settings
     */
    protected getDefaultSettings(): Settings {
        return {
            enabled: true,
            keepHistory: false,
        };
    }

    /**
     * Creates the module's structure.  
     * Should be run immediately after the constructor finishes.
     */
    public create(): void {
        super.create();

        this.$postContainer = $("#posts-container");

        this.$loadingIndicator = $("<div>")
            .attr("id", "re-infinite-scroll-loading")
            .html(`<i class="fas fa-circle-notch fa-5x fa-spin"></i>`)
            .insertAfter(this.$postContainer);
        this.$loadingIndicator.hide();

        this.$nextButton = $("<a>").text("Load next").on("click", () => {
            this.addMorePosts(true);
        });
        this.$nextButton
            .attr("id", "re-infinite-scroll-next")
            .addClass("text-center")
            .insertAfter(this.$postContainer);

        this.currentQuery = Page.getQueryParameter("tags") !== null ? Page.getQueryParameter("tags") : "";

        const keepHistory = this.fetchSettings("keepHistory");

        if (keepHistory) this.currentPage = parseInt(Page.getQueryParameter("xpage")) || 1;
        else this.currentPage = parseInt(Page.getQueryParameter("page")) || 1;

        this.isInProgress = false;
        this.pagesLeft = true;

        // Listen for other modules trying to pause loading additional pages
        InfiniteScroll.on("pauseScroll.main", (event, scrollPaused) => {
            if (typeof scrollPaused === "undefined") return;
            else this.scrollPaused = scrollPaused;
        });

        // Wait until all images are loaded, to prevent fetching posts 
        // while the layout is still changing
        $(async () => {
            // Load previous result pages on document load
            if (keepHistory) {
                let processingPage = 2;
                while (processingPage <= this.currentPage) {
                    await this.loadPage(processingPage, {
                        scrollToPage: true,
                        lazyload: false,
                    });
                    processingPage++;
                }

                $("img.later-lazyload").removeClass("later-lazyload").addClass("lazyload");
            }

            // Load the next result page when scrolled to the bottom
            let timer: number;
            $(window).scroll(() => {
                if (timer) return;
                timer = window.setTimeout(async () => {
                    await this.addMorePosts();
                    timer = null;
                }, 1000);
            });
        });
    }

    public destroy(): void {
        super.destroy();

        this.$nextButton.remove();
        InfiniteScroll.off("pauseScroll.main");
    }

    /**
     * Adds more posts to the site, if the user has scrolled down enough
     */
    private async addMorePosts(override = false): Promise<boolean> {
        if (!this.isEnabled() || this.isInProgress || !this.pagesLeft || !this.shouldAddMore(override) || this.scrollPaused) {
            return Promise.resolve(false);
        }

        const pageLoaded = await this.loadPage(this.currentPage + 1);
        if (pageLoaded) {
            Page.setQueryParameter((this.fetchSettings("keepHistory") ? "x" : "") + "page", (this.currentPage + 1).toString());
            this.currentPage++;
            InfiniteScroll.trigger("pageLoad");
        }
        return Promise.resolve(pageLoaded);
    }

    private async loadPage(page: number, options = { scrollToPage: false, lazyload: true }): Promise<boolean> {
        this.isInProgress = true;
        this.$loadingIndicator.show();

        const posts = await E621.Posts.get<APIPost>({ tags: this.currentQuery, page: page }, 500);
        if (posts.length === 0) {
            this.pagesLeft = false;
            this.$loadingIndicator.hide();
            this.$nextButton.hide();
            Danbooru.notice("No more posts!");
            return Promise.resolve(false);
        }

        const keepHistory = this.fetchSettings("keepHistory");

        $("<a>")
            .attr({
                "href": document.location.href + "#" + (keepHistory ? "x" : "") + "page-link-" + page,
                "id": (keepHistory ? "x" : "") + "page-link-" + page
            })
            .addClass("instantsearch-seperator")
            .html("<h2>Page: " + page + "</h2>")
            .appendTo(this.$postContainer);

        if (options.scrollToPage) {
            $([document.documentElement, document.body]).animate({
                scrollTop: $("a#" + (keepHistory ? "x" : "") + "page-link-" + page).offset().top
            }, '0');
        }

        const thumbnailEnhancer = ModuleController.get(ThumbnailEnhancer),
            upscaleMode: ThumbnailPerformanceMode = thumbnailEnhancer.fetchSettings("upscale"),
            clickAction: ThumbnailClickAction = thumbnailEnhancer.fetchSettings("clickAction"),
            flagData = ModuleController.get(CustomFlagger).fetchSettings<FlagDefinition[]>("flags");

        const promises: Promise<void>[] = [];
        for (const json of posts) {
            promises.push(new Promise((resolve) => {
                const element = PostHtml.create(json, options.lazyload, upscaleMode === ThumbnailPerformanceMode.Always);
                const post = new Post(element);

                //only append the post if it has image data
                //if it does not it is part of the anon blacklist
                if (post.getImageURL() !== undefined) {
                    //Add post to the list of posts currently visible
                    //This is important because InstantSearch relies on it
                    Post.appendPost(post);

                    //Apply blacklist before appending, to prevent image loading
                    post.applyBlacklist();

                    this.$postContainer.append(element);

                    ThumbnailEnhancer.modifyThumbnail(element, upscaleMode, clickAction);
                    CustomFlagger.modifyThumbnail(element, flagData);
                }

                resolve();
            }));
        }

        Promise.all(promises).then(() => {
            this.isInProgress = false;
            this.$loadingIndicator.hide();

            BlacklistEnhancer.trigger("updateSidebar");
            InstantSearch.trigger("applyFilter");
        });

        return Promise.resolve(true);
    }

    /**
     * Checks if the user has scrolled down enough, so that more
     * posts should be appended
     */
    private shouldAddMore(override: boolean): boolean {
        return $(window).scrollTop() + $(window).height() > $(document).height() - 50 || override;
    }

}
