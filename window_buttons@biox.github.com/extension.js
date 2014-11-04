/*global log, global */ // <-- for jshint
/* Window Button GNOME shell extension.
 * Copyright (C) 2011 Josiah Messiah (josiah.messiah@gmail.com)
 * Licence: GPLv3
 *
 * Contributors:
 * - Josiah Messiah <josiah.messiah@gmail.com>
 * - barravi <https://github.com/barravi>
 * - tiper <https://github.com/tiper>
 * - mathematical.coffee <mathematical.coffee@gmail.com>
 * - cjclavijo
 */

const Lang = imports.lang;
const St = imports.gi.St;
const GConf = imports.gi.GConf;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Shell = imports.gi.Shell;

const ExtensionUtils = imports.misc.extensionUtils;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Prefs = Me.imports.prefs;
let extensionPath = "";

// Settings
const WA_PINCH = Prefs.WA_PINCH;
const WA_ORDER = Prefs.WA_ORDER;
const WA_THEME = Prefs.WA_THEME;
const WA_DO_METACITY = Prefs.WA_DO_METACITY;
const WA_LEFTBOX = Prefs.WA_LEFTBOX;
const WA_LEFTPOS = Prefs.WA_LEFTPOS;
const WA_RIGHTPOS = Prefs.WA_RIGHTPOS;
const WA_RIGHTBOX = Prefs.WA_RIGHTBOX;
const WA_SHOWBUTTONS = Prefs.WA_SHOWBUTTONS;
const WA_HIDEINOVERVIEW = Prefs.WA_HIDEINOVERVIEW;

// Keep enums in sync with GSettings schemas
const PinchType = Prefs.PinchType;
const Boxes = Prefs.Boxes;
const ShowButtonsWhen = Prefs.ShowButtonsWhen;

// Laziness
Meta.MaximizeFlags.BOTH = (Meta.MaximizeFlags.HORIZONTAL |
    Meta.MaximizeFlags.VERTICAL);

const _ORDER_DEFAULT = ":minimize,maximize,close";
const DCONF_META_PATH = 'org.gnome.desktop.wm.preferences';

/********************
 * Helper functions *
 ********************/
function warn(msg) {
    log("WARNING [Window Buttons]: " + msg);
}

/* Get the metacity button layout.
 * On GNOME 3.2, this can be found in GCONF key
 * /apps/metacity/general/button_layout. On GNOME 3.4, the gconf key does not
 * exist and you must use org.gnome.desktop.wm.preferences button-layout.
 */
function getMetaButtonLayout() {
    // try Gio.Settings first. Cannot query non-existant schema in 3.2 or
    // we'll get a segfault.
    let order;
    try {
        // the following code will *only* work in GNOME 3.4 (schema_id property
        // is 'schema' in GNOME 3.2):
        order = new Gio.Settings({schema_id: DCONF_META_PATH}).get_string(
            'button-layout');
    } catch (err) {
        // GNOME 3.2
        order = GConf.Client.get_default().get_string(
                "/apps/metacity/general/button_layout");
    }
    return order;
}

/* convert Boxes.{LEFT,RIGHT,MIDDLE} into
 * Main.panel.{_leftBox, _rightBox, _centerBox}
 */
function getBox(boxEnum) {
    let box = null;
    switch (boxEnum) {
    case Boxes.MIDDLE:
        box = Main.panel._centerBox;
        break;
    case Boxes.LEFT:
        box = Main.panel._leftBox;
        break;
    case Boxes.RIGHT:
        /* falls through */
    default:
        box = Main.panel._rightBox;
        break;
    }
    return box;
}

/* Get the number of *visible* children in an actor. */
function getNChildren(act) {
    return act.get_children().filter(function (c) { return c.visible; }).length;
}

/* Convert position.{left,right}.position to a position that insert_actor can
 * handle.
 * Here 'position' is the position you want  amongst all
 * *visible* children of actor.
 * (e.g. for me on GNOME 3.4 the bluetooth indicator is a child of
 * Main.panel._leftBox, but isn't visible because I don't have bluetooth.
 */
function getPosition(actor, position, nvisible) {
    if (position < 0) {
        let n = actor.get_children().length;
        if (nvisible !== n && nvisible > 0) {
            // you want to get the `position`th item amongst the *visible*
            // children, but you have to call insert_actor on an index amongst
            // *all* children of actor.
            let pos = 0,
                nvis = 0,
                children = actor.get_children();
            for (let i = n - 1; i >= 0 && nvis < -position; --i) {
                pos -= 1;
                if (children[i].visible) {
                    nvis++;
                }
            }
            position = pos;
        }
        return n + position + 1;
    } else { // position 1 ("first item on the left") is index 0
        let n = actor.get_children().length;
        if (nvisible !== n && nvisible > 0) {
            let nvis = 0,
                pos = 0,
                children = actor.get_children();
            for (let i = 0; i < n && nvis < position; ++i) {
                pos += 1;
                if (children[i].visible) {
                    nvis++;
                }
            }
            position = pos;
        }
        return Math.max(0, position - 1);
    }
}

/************************
 * Window Buttons class *
 ************************/
function WindowButtons() {
    this._init();
}

WindowButtons.prototype = {
    __proto__: PanelMenu.ButtonBox.prototype,

    _init: function () {
        this._wmSignals = [];
        this._overviewSignals = [];
        this._windowTrackerSignal = 0;
        this._locked = false;
    },

    _loadTheme: function () {

        let theme,
            oldtheme = this.theme_path || false,
            doMetacity = this._settings.get_boolean(WA_DO_METACITY);

        if (doMetacity) {
            theme = Meta.prefs_get_theme();
        } else {
            theme = this._settings.get_string(WA_THEME);
        }

        // if still no theme, use the old one or 'default'
        if (!theme) {
            warn("Could not load the requested theme.");
            theme = oldtheme || 'default';
        }
        if (theme === oldtheme) {
            return;
        }

        // Get CSS of new theme, and check it exists, falling back to 'default'
        let cssPath = GLib.build_filenamev([extensionPath, 'themes', theme,
                                            'style.css']);
        if (!GLib.file_test(cssPath, GLib.FileTest.EXISTS)) {
            cssPath = GLib.build_filenamev([extensionPath,
                                            'themes/default/style.css']);
        }

        let themeContext = St.ThemeContext.get_for_stage(global.stage),
            currentTheme = themeContext.get_theme();
        if (oldtheme) {
            // unload the old style
            currentTheme.unload_stylesheet(oldtheme);
        }
        // load the new style
        currentTheme.load_stylesheet(cssPath);

        // The following forces the new style to reload (it may not be the only
        // way to do it; running the cursor over the buttons works too)
        this.rightActor.grab_key_focus();
        this.leftActor.grab_key_focus();

        this.theme_path = cssPath;
    },

    _display: function () {
        // TODO: if order changes I don't have to destroy all the children,
        // I can just re-insert them!

        let boxes = [ this.leftBox, this.rightBox ];
        for (let box = 0; box < boxes.length; ++box) {
            let children = boxes[box].get_children();
            for (let i = 0; i < children.length; ++i) {
                children[i].destroy();
            }
        }

        let pinch = this._settings.get_enum(WA_PINCH);
        let order = _ORDER_DEFAULT;

        order = getMetaButtonLayout();
        
        /* if order is null because keys don't exist, get them from settings
         * (PinchType.CUSTOM) */
        if (pinch === PinchType.CUSTOM || !order || !order.length) {
            order = this._settings.get_string(WA_ORDER);
        }
        /* If still no joy, use a default of :minmize,maximizeclose ... */
        if (!order || !order.length) {
            order = _ORDER_DEFAULT;
        }


        let buttonlist = {  minimize : ['Minimize', this._minimize],
                            maximize : ['Maximize', this._maximize],
                            close    : ['Close', this._close] },
            orders     = order.replace(/ /g, '').split(':');

        /* Validate order */
        if (orders.length === 1) {
            // didn't have a ':'
            warn("Malformed order (no ':'), will insert at the front.");
            orders = ['', orders[0]];
        }

        let orderLeft  = orders[0].split(','),
            orderRight = orders[1].split(',');

        if (orderRight != "") {
            for (let i = 0; i < orderRight.length; ++i) {
                if (!buttonlist[orderRight[i]]) {
                    // skip if the butto name is not right...
                    warn("\'%s\' is not a valid button.".format(
                                orderRight[i]));
                    continue;
                }
                let button = new St.Button({
                    style_class: orderRight[i]  + ' window-button',
                    track_hover: true
                });
                //button.set_tooltip_text(buttonlist[orderRight[i]][0]);
                button.connect('button-press-event', Lang.bind(this,
                            buttonlist[orderRight[i]][1]));
                this.rightBox.add(button);
            }
        }

        if (orderLeft != "") {
            for (let i = 0; i < orderLeft.length; ++i) {
                if (!buttonlist[orderLeft[i]]) {
                    warn("\'%s\' is not a valid button.".format(
                                orderLeft[i]));
                    // skip if the butto name is not right...
                    continue;
                }
                let button = new St.Button({
                    style_class: orderLeft[i] + ' window-button',
                    track_hover: true
                });
                //button.set_tooltip_text(buttonlist[orderLeft[i]][0]);
                button.connect('button-press-event', Lang.bind(this,
                            buttonlist[orderLeft[i]][1]));
                this.leftBox.add(button);
            }
        }
    },

    /*
     * ShowButtonsWhen.ALWAYS, WINDOWS, WINDOWS_VISIBLE,
     * CURRENT_WINDOW_MAXIMIZED, ANY_WINDOW_MAXIMIZED, ANY_WINDOW_FOCUSED
     */
    _windowChanged: function () {
        let workspace = global.screen.get_active_workspace(),
            windows = workspace.list_windows().filter(function (w) {
                return w.get_window_type() !== Meta.WindowType.DESKTOP;
            }),
            show = false;

        // if overview is active won't show the buttons
        if (this._settings.get_boolean(WA_HIDEINOVERVIEW) &&
                Main.overview.visible) {
            show = false;
        } else {
            switch (this._settings.get_enum(WA_SHOWBUTTONS)) {
            // show whenever there are windows
            case ShowButtonsWhen.WINDOWS:
                show = windows.length;
                break;
           
            // show whenever there are non-minimized windows
            case ShowButtonsWhen.WINDOWS_VISIBLE:
                for (let i = 0; i < windows.length; ++i) {
                    if (!windows[i].minimized) {
                        show = true;
                        break;
                    }
                }
                break;

            // show iff current window is (fully) maximized
            case ShowButtonsWhen.CURRENT_WINDOW_MAXIMIZED:
                let activeWindow = global.display.focus_window;
                show = (activeWindow ?
                        activeWindow.get_maximized() === Meta.MaximizeFlags.BOTH :
                        false);
                break;

            // show iff *any* window is (fully) maximized
            case ShowButtonsWhen.ANY_WINDOW_MAXIMIZED:
                for (let i = 0; i < windows.length; ++i) {
                    if (windows[i].get_maximized() === Meta.MaximizeFlags.BOTH &&
                            !windows[i].minimized) {
                        show = true;
                        break;
                    }
                }
                break;

            // show iff *any* window is focused.
            case ShowButtonsWhen.ANY_WINDOW_FOCUSED:
                show = global.display.focus_window;
                break;

            // show all the time
            case ShowButtonsWhen.ALWAYS:
                /* falls through */
            default:
                show = true;
                break;
            }
        }

        var showLeft = show && (this.leftBox.get_children().length > 0);
        if (showLeft !== this.leftActor.visible) {
            if (showLeft) {
                this.leftActor.show();
            } else {
                this.leftActor.hide();
            }
        }

        var showRight = show && (this.rightBox.get_children().length > 0);
        if (showRight !== this.rightActor.visible) {
            if (showRight) {
                this.rightActor.show();
            } else {
                this.rightActor.hide();
            }
        }

        return false;
    },

    // Returns the window to control.
    // This is:
    // * the currently focused window.
    // * onlymax is TRUE, in which case it is the uppermost *maximized*
    //   window, whether or not this is active or not. If there are no
    //   maximized windows, it defaults to:
    // * the currently focused window.
    // * if all else fails, we return the uppermost window.
    _getWindowToControl: function () {
        let win = global.display.focus_window,
            workspace = global.screen.get_active_workspace(),
            windows = workspace.list_windows().filter(function (w) {
                return w.get_window_type() !== Meta.WindowType.DESKTOP;
            });
        // BAH: list_windows() doesn't return in stackin order (I thought it did)
        windows = global.display.sort_windows_by_stacking(windows);

        if (win === null || win.get_window_type() === Meta.WindowType.DESKTOP) {
            // No windows are active, control the uppermost window on the
            // current workspace
            if (windows.length) {
                win = windows[windows.length - 1].get_meta_window();
            }
        }

        // Incorporate onlymax behaviour: get the uppermost maximized window
        if (this._settings.get_enum(WA_SHOWBUTTONS) ===
                ShowButtonsWhen.ANY_WINDOW_MAXIMIZED) {
            let i = windows.length;
            while (i--) {
                if (windows[i].get_maximized() === Meta.MaximizeFlags.BOTH &&
                        !windows[i].minimized) {
                    win = windows[i];
                    break;
                }
            }
        }
        return win;
    },

    _minimize: function () {
        let win = this._getWindowToControl();
        if (!win) {
            return;
        }

        // minimize/unmaximize
        if (win.minimized) {
            win.unminimize();
            win.activate(global.get_current_time());
        } else {
            win.minimize();
        }
    },

    _maximize: function () {
        let win = this._getWindowToControl();
        if (!win) {
            return;
        }

        // maximize/unmaximize. We count half-maximized as not maximized & will
        // fully maximize it.
        if (win.get_maximized() === Meta.MaximizeFlags.BOTH) {
            win.unmaximize(Meta.MaximizeFlags.BOTH);
        } else {
            win.maximize(Meta.MaximizeFlags.BOTH);
        }
        win.activate(global.get_current_time());
    },

    _close: function () {
        let win = this._getWindowToControl();
        if (!win) {
            return;
        }

        // close it.
        win.delete(global.get_current_time());
    },

    _onPositionChange: function (settings, changedKey, positionKey, boxKey) {
        if (this._locked) {
            return;
        }
        let pos = this._settings.get_int(positionKey),
            newPos = pos,
            box = this._settings.get_enum(boxKey),
            newBox = box,
            n = getNChildren(getBox(box));

        // if pos is 0, we are waiting on a box change and then another
        // position change with the proper non-zero position (this is since
        // we can't import Main from prefs.js to check the number of
        // children in Main.panel._xxxBox).
        if (pos === 0) {
            return;
        }

        this._locked = true;
        if (n === 0) {
            // if there are no children set this
            // as the first.
            pos = 1;
        } else if (pos < -n) { // moving left through to the next box
            // we have to process a change in the box
            newBox = Prefs.cycleBox(box, false);
            newPos = -1;
        } else if (pos > n) { // moving right through to the next box
            newBox = Prefs.cycleBox(box, true);
            newPos = 1;

        // When we pass the half-way mark, switch from anchoring left to
        // anchoring right (or vice versa moving backwards).
        } else if (pos > 0 && pos > (n + 1) / 2) {
            newPos = pos - n - 1;
        } else if (pos < 0 && -pos > (n + 1) / 2)  {
            newPos = n + pos + 1;
        } else if (pos === 0) {
            // should have been taken care of
            warn("!!! [Window Buttons] !!! pos === 0, this shouldn\'t happen");
            // will just guess pos = 1 ... (move to LHS of the current box)
            newPos = 1;
        }

        if (newBox !== box) {
            this._settings.set_enum(boxKey, newBox);
        }
        if (newPos !== pos) {
            this._settings.set_int(positionKey, newPos);
        }

        // now actually process the changes.
        // FIXME: in GNOME 3.4 can use .set_child_at_index.
        let container = (positionKey === WA_LEFTPOS ? '_leftContainer' :
            '_rightContainer'),
            actor = (positionKey === WA_LEFTPOS ? this.leftActor :
                this.rightActor);
        box = getBox(newBox);
        this[container].remove_actor(actor);
        if (this[container] !== box) {
            this[container] = box;
        }
        // TODO: has nchildren updated by now? should we do getPosition
        // ourselves?
        newPos = getPosition(this[container], newPos, n);
        this[container].insert_child_at_index(actor, newPos);

        this._locked = false;
    },

    _connectSignals: function () {
        let showbuttons = this._settings.get_enum(WA_SHOWBUTTONS);

        if (this._settings.get_boolean(WA_HIDEINOVERVIEW)) {
            // listen to the overview showing & hiding.
            this._overviewSignals.push(Main.overview.connect('shown',
                Lang.bind(this, this._windowChanged)));
            this._overviewSignals.push(Main.overview.connect('hidden',
                Lang.bind(this, this._windowChanged)));
        }

        // if we show the buttons as long as a window is focused it is sufficient
        // to listen to notify::focus-app (a window is focused if and only if an
        // its app is focused .. (?))
        if (showbuttons === ShowButtonsWhen.ANY_WINDOW_FOCUSED) {
            this._windowTrackerSignal = Shell.WindowTracker.get_default().connect(
                    'notify::focus-app', Lang.bind(this, this._windowChanged));
            return;
        }

        // if we are always showing the buttons then we don't have to listen
        // to window events
        if (showbuttons === ShowButtonsWhen.ALWAYS) {
            return;
        }

        // for mode WINDOWS we only need to listen to map and destroy and
        // switch-workspace (we just want to detect whether there are any
        // windows at all on the WS)
        this._wmSignals.push(global.window_manager.connect('switch-workspace',
            Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('map',
			Lang.bind(this, this._windowChanged)));
        // note: 'destroy' needs a delay for .list_windows() report correctly
        this._wmSignals.push(global.window_manager.connect('destroy',
			Lang.bind(this, function () {
                Mainloop.idle_add(Lang.bind(this, this._windowChanged));
            })));
        if (showbuttons === ShowButtonsWhen.WINDOWS) {
            return;
        }

        // for WINDOWS_VISIBLE we additionally need to listen to min (unmin
        // is covered by map)
        this._wmSignals.push(global.window_manager.connect('minimize',
			Lang.bind(this, this._windowChanged)));

        if (showbuttons === ShowButtonsWhen.WINDOWS_VISIBLE) {
            return;
        }

        // for any_window_maximized we additionaly have to be aware of max/unmax
        // events.
        this._wmSignals.push(global.window_manager.connect('maximize',
			Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('unmaximize',
			Lang.bind(this, this._windowChanged)));

        if (showbuttons === ShowButtonsWhen.ANY_WINDOW_MAXIMIZED) {
            return;
        }

        // for current_window_maximized we additionally want focus-app
        // NOTE: this fires twice per focus-event, the first with activeWindow
        // being `null` and the second with it being the newly-focused window.
        // (Unless there is no newly-focused window).
        // What a waste!
        this._windowTrackerSignal = Shell.WindowTracker.get_default().connect(
                'notify::focus-app', Lang.bind(this, this._windowChanged));
    },

    _disconnectSignals: function () {
        if (this._windowTrackerSignal) {
            Shell.WindowTracker.get_default().disconnect(this._windowTrackerSignal);
        }
        for (let i = 0; i < this._wmSignals; ++i) {
            global.window_manager.disconnect(this._wmSignals.pop());
        }
        for (let i = 0; i < this._overviewSignals; ++i) {
            Main.overview.disconnect(this._overviewSignals.pop());
        }
        this._wmSignals = [];
        this._overviewSignals = [];
        this._windowTrackerSignal = 0;
    },

    enable: function () {
        this._settings = Convenience.getSettings();
        this._settingsSignals = [];
        this._locked = false;
        //Create boxes for the buttons
        this.rightActor = new St.Bin({ style_class: 'box-bin'});
        this.rightBox = new St.BoxLayout({ style_class: 'button-box' });
        this.leftActor = new St.Bin({ style_class: 'box-bin'});
        this.leftBox = new St.BoxLayout({ style_class: 'button-box' });

        //Add boxes to bins
        this.rightActor.add_actor(this.rightBox);
        this.leftActor.add_actor(this.leftBox);
        //Add button to boxes
        this._display();

        //Load Theme
        this._loadTheme();

        //Connect to setting change events
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_DO_METACITY,
                Lang.bind(this, this._loadTheme)));
        this._settingsSignals.push(this._settings.connect(
                    'changed::' + WA_THEME,
                Lang.bind(this, this._loadTheme)));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_ORDER,
                Lang.bind(this, this._display)));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_PINCH,
                Lang.bind(this, this._display)));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_SHOWBUTTONS,
                Lang.bind(this, function () {
                    this._disconnectSignals();
                    this._connectSignals();
                    this._windowChanged();
                })));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_HIDEINOVERVIEW,
                Lang.bind(this, function () {
                    this._disconnectSignals();
                    this._connectSignals();
                    this._windowChanged();
                })));

        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_LEFTPOS,
                Lang.bind(this, this._onPositionChange, WA_LEFTPOS, WA_LEFTBOX)));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_RIGHTPOS,
                Lang.bind(this, this._onPositionChange, WA_RIGHTPOS, WA_RIGHTBOX)));

        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_LEFTBOX,
                Lang.bind(this, this._onPositionChange, WA_LEFTPOS, WA_LEFTBOX)));
        this._settingsSignals.push(this._settings.connect(
                'changed::' + WA_RIGHTBOX,
                Lang.bind(this, this._onPositionChange, WA_RIGHTPOS, WA_RIGHTBOX)));

        // Connect to window change events
        this._wmSignals = [];
        this._windowTrackerSignal = 0;
        this._connectSignals();

        let leftbox = this._settings.get_enum(WA_LEFTBOX),
            rightbox = this._settings.get_enum(WA_RIGHTBOX),
            leftpos = this._settings.get_int(WA_LEFTPOS),
            rightpos = this._settings.get_int(WA_RIGHTPOS);

        this._leftContainer = getBox(leftbox);
        this._rightContainer = getBox(rightbox);

        // A delay is needed to let all the other icons load first.
        // Also, show or hide buttons after a delay to let all the windows
        // be properly "there".
        Mainloop.idle_add(Lang.bind(this, function () {
            this._leftContainer.insert_child_at_index(this.leftActor,
                    getPosition(this._leftContainer, leftpos,
                        getNChildren(this._leftContainer)));
            this._rightContainer.insert_child_at_index(this.rightActor,
                    getPosition(this._rightContainer,
                        rightpos, getNChildren(this._rightContainer)));

            // Show or hide buttons
            this._windowChanged();

            return false;
        }));

    },

    disable: function () {
        this.leftActor.destroy();
        this.rightActor.destroy();

        /* disconnect all signals */
        let i = this._settingsSignals.length;
        while (i--) {
            this._settings.disconnect(this._settingsSignals.pop());
        }
        this._settings = null;
        this._disconnectSignals();
    }
};

function init(extensionMeta) {
    extensionPath = extensionMeta.path;
    return new WindowButtons();
}
