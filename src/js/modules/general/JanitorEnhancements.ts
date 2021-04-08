import { Page, PageDefinition } from "../../components/data/Page";
import { RE6Module } from "../../components/RE6Module";

export class JanitorEnhancements extends RE6Module {

    private deletionReasons = [
        "Inferior version/duplicate of post #",
        "Irrelevant to site",
        "Excessive same base image set",
        "Colored base",
        "",
        "Does not meet minimum quality standards (Artistic)",
        "Does not meet minimum quality standards. (Bad digitization of traditional media)",
        "Broken/corrupted file",
        "JPG resaved as PNG",
        "",
        "Paysite/commercial content",
        "Conditional DNP: Only the artist is allowed to post",
        "The artist of this post is on the [[avoid posting list]]",
    ];

    public constructor() {
        super([], true);
    }

    public create(): void {

        if (Page.matches(PageDefinition.postConfirmDelete)) {
            this.appendDeletionReasons();
        }

    }

    private appendDeletionReasons(): void {
        const form = $("form.simple_form");
        const input = $("#reason");

        const suggestionsWrapper = $("<div>")
            .addClass("deletion-reason-suggestions")
            .appendTo(form);

        for (const reason of this.deletionReasons) {
            if (reason == "") $("<br />").appendTo(suggestionsWrapper);
            else $("<a>")
                .html(reason)
                .appendTo(suggestionsWrapper)
                .on("click", (event) => {
                    event.preventDefault();
                    input.val((index, current) => {
                        if (current.length > 0) current += " / ";
                        return current + reason;
                    });
                });
        }
    }

}