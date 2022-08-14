import css from "./css/style.module.scss";

import User from "./js/components/data/User";
import DOMTools from "./js/components/structure/DOMTools";
import PageObserver from "./js/components/structure/PageObserver";
import ErrorHandler from "./js/components/utility/ErrorHandler";
import Util from "./js/components/utility/Util";
import Debug from "./js/models/Debug";
import Script from "./js/models/Script";
import { ComponentList } from "./js/modules/Component";
import HeaderCustomizer from "./js/modules/general/HeaderCustomizer";
import SettingsManager from "./js/modules/general/SettingsManager";
import ThemeCustomizer from "./js/modules/general/ThemeCustomizer";
import HeaderButtons from "./js/modules/minor/HeaderButtons";

export class RE621 {

    // Fill in type suggestions
    public static Registry: ComponentListAnnotated = {};

    private loadOrder = [
        // Header
        ThemeCustomizer,
        HeaderCustomizer,
        HeaderButtons,

        // Must wait for all other settings to load
        SettingsManager,
    ];

    public async run(): Promise<void> {

        console.log("%c[RE621]%c v." + Script.version, "color: maroon", "color: unset");

        // Initialize basic functionality
        try {
            Debug.log("+ Page Observer");
            PageObserver.init();

            // Append the CSS to head, and make sure it overrides other styles
            PageObserver.watch("head").then(() => {
                Debug.log("+ HEAD is ready");
                const styleElement = DOMTools.addStyle(css);
                $(() => { styleElement.appendTo("head"); });
            });

            PageObserver.watch("body").then(() => {
                Debug.log("+ BODY is ready");
                // Dialog.init();
                DOMTools.setupDialogContainer(); // TODO Move to the dialog class
                User.init();
            });

            PageObserver.watch("menu.main").then(() => {
                Debug.log("+ MENU is ready");
                DOMTools.patchHeader();
            });
        } catch (error) {
            ErrorHandler.log("An error ocurred during script initialization", error);
            return;
        }

        // Start loading components
        let loaded = 0;
        const total = Object.keys(this.loadOrder).length;
        for (const module of this.loadOrder) {
            const instance = new module();
            RE621.Registry[instance.getName()] = instance;
            await instance.bootstrapSettings();
            loaded++;
            if (loaded >= total) {
                Util.Events.trigger("re621.bootstrap");
                console.log("%c[RE621]%c loaded", "color: maroon", "color: unset");
            }
            instance.init(); // Deliberately not-awaited
        }
    }

}
new RE621().run();

interface ComponentListAnnotated extends ComponentList {
    // Header
    HeaderCustomizer?: HeaderCustomizer,
    ThemeCustomizer?: ThemeCustomizer,
    DMailHeaderButton?: HeaderButtons,

    // Settings
    SettingsManager?: SettingsManager,
}
