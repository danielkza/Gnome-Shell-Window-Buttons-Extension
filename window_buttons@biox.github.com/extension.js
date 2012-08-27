/*global log, global */ // <-- for jshint
// Copyright (C) 2011 Josiah Messiah (josiah.messiah@gmail.com)
// Other contributors:
// Maintainer: mathematicalcoffee <mathematical.coffee@gmail.com>
// Patches contributed by:
// - barravi (GNOME 3.4 compatibility)
// - tiper (GNOME 3.4 compatibility)
// Licence: GPLv3

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
const WA_ONLYMAX = Prefs.WA_ONLYMAX;
const WA_HIDEONNOMAX = Prefs.WA_HIDEONNOMAX;
const WA_LEFTBOX = Prefs.WA_LEFTBOX;
const WA_LEFTPOS = Prefs.WA_LEFTPOS;
const WA_RIGHTPOS = Prefs.WA_RIGHTPOS;
const WA_RIGHTBOX = Prefs.WA_RIGHTBOX;

// Keep enums in sync with GSettings schemas
const PinchType = Prefs.PinchType;
const Boxes = Prefs.Boxes;

// Laziness
Meta.MaximizeFlags.BOTH = (Meta.MaximizeFlags.HORIZONTAL |
    Meta.MaximizeFlags.VERTICAL);

const _ORDER_DEFAULT = ":minimize,maximize,close";
const DCONF_META_THEME_KEY = 'org.gnome.desktop.wm.preferences';
const GCONF_META_THEME_KEY = '/apps/metacity/general/theme';

function warn(msg) {
    log("WARNING [Window Buttons]: " + msg);
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

function WindowButtons() {
    this._init();
}

WindowButtons.prototype = {
    __proto__: PanelMenu.ButtonBox.prototype,

    _init: function () {
        //Load Settings
        this._settings = Convenience.getSettings();

        this._wmSignals = [];
        this._windowTrackerSignal = 0;
        this._locked = false;
    },

    _loadTheme: function () {

        let theme,
            oldtheme = this.theme_path || false,
            doMetacity = this._settings.get_boolean(WA_DO_METACITY);

        if (doMetacity) {
            // GTK theme name:
            // theme = Gio.Settings.new('org.gnome.desktop.interface'
            // ).get_string('gtk-theme')

            // Get Mutter / Metacity theme name.
            // try dconf (GNOME 3.4) first. NOTE: on GNOME 3.2 this will
            // segfault if the schema is not installed, hence we use
            // Gio.Settings.list_schemas():
            theme = Gio.Settings.list_schemas().filter(function (k) {
                return k === DCONF_META_THEME_KEY;
            });
            if (theme.length) {
                // dconf, GNOME 3.4
                theme = Gio.Settings.new(DCONF_META_THEME_KEY);
                theme = theme.get_string('theme');
            } else {
                // gconf, GNOME 3.2
                // GNOME 3.2:
                theme = GConf.Client.get_default().get_string(
                        GCONF_META_THEME_KEY);
            }
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
        // log('_loadTheme: %s -> %s'.format(oldtheme.toString(), theme));

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

        if (pinch === PinchType.MUTTER) {
            order = GConf.Client.get_default().get_string(
                    "/desktop/gnome/shell/windows/button_layout");
        } else if (pinch === PinchType.METACITY) {
            order = GConf.Client.get_default().get_string(
                    "/apps/metacity/general/button_layout");
        } else if (pinch === PinchType.GNOME_SHELL) {
            order = Gio.Settings.new(
                'org.gnome.shell.overrides'
            ).get_string('button-layout');
        }
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

    _windowChanged: function () {
        let hideonnomax = this._settings.get_boolean(WA_HIDEONNOMAX),
            onlymax = this._settings.get_boolean(WA_ONLYMAX);
        if (onlymax && hideonnomax) {
            let activeWindow = global.display.focus_window;
            if (this._upperMax()) {
                this.leftActor.show();
                this.rightActor.show();
            } else {
                this.leftActor.hide();
                this.rightActor.hide();
            }
        }
    },

    // Return the uppermost maximized window from the current workspace, or
    // false is there is none
    _upperMax: function () {
        let workspace = global.screen.get_active_workspace();
        let windows = workspace.list_windows();
        let maxwin = false;
        for (let i = windows.length - 1; i >= 0; --i) {
            if (windows[i].get_maximized() === Meta.MaximizeFlags.BOTH &&
                    !windows[i].minimized) {
                maxwin = windows[i];
                break;
            }
        }
        return maxwin;
    },

    _minimize: function () {
        let activeWindow = global.display.focus_window,
            onlymax = this._settings.get_boolean(WA_ONLYMAX);
        if (activeWindow === null || activeWindow.get_title() === "Desktop") {
            // No windows are active, minimize the uppermost window
            let winactors = global.get_window_actors();
            let uppermost = winactors[winactors.length - 1].get_meta_window();
            uppermost.minimize();
        } else {
            // If the active window is maximized, minimize it
            if (activeWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
                activeWindow.minimize();
            // If the active window is not maximized, minimize the uppermost
            // maximized window if the option to only control maximized windows
            // is set
            } else if (onlymax) {
                let uppermax = this._upperMax();
                if (uppermax) {
                    uppermax.minimize();
                    activeWindow.activate(global.get_current_time());
                } else {
                    // If no maximized windows, minimize the active window
                    activeWindow.minimize();
                }
            // Otherwise minimize the active window
            } else {
                activeWindow.minimize();
            }
        }
    },

    _maximize: function () {
        let activeWindow = global.display.focus_window,
            onlymax = this._settings.get_boolean(WA_ONLYMAX);
        if (activeWindow === null || activeWindow.get_title() === "Desktop") {
            // No windows are active, maximize the uppermost window
            let winactors = global.get_window_actors();
            let uppermost = winactors[winactors.length - 1].get_meta_window();
            uppermost.maximize(Meta.MaximizeFlags.BOTH);
            // May as well activate it too...
            uppermost.activate(global.get_current_time());
        } else {
            // If the active window is maximized, unmaximize it
            if (activeWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
                activeWindow.unmaximize(Meta.MaximizeFlags.BOTH);
            // If the active window is not maximized, unmaximize the uppermost
            // maximized window if the option to only control maximized windows
            // is set
            } else if (onlymax) {
                let uppermax = this._upperMax();
                if (uppermax) {
                    uppermax.unmaximize(Meta.MaximizeFlags.BOTH);
                    activeWindow.activate(global.get_current_time());
                } else {
                    activeWindow.maximize(Meta.MaximizeFlags.BOTH);
                }
            // Otherwise unmaximize the active window
            } else {
                activeWindow.maximize(Meta.MaximizeFlags.BOTH);
            }
        }
    },

    _close: function () {
        let activeWindow = global.display.focus_window,
            onlymax = this._settings.get_boolean(WA_ONLYMAX);
        if (activeWindow === null || activeWindow.get_title() === "Desktop") {
            // No windows are active, close the uppermost window
            let winactors = global.get_window_actors();
            let uppermost = winactors[winactors.length - 1].get_meta_window();
            uppermost.delete(global.get_current_time());
        } else {
            // If the active window is maximized, close it
            if (activeWindow.get_maximized() === Meta.MaximizeFlags.BOTH) {
                activeWindow.delete(global.get_current_time());
            // If the active window is not maximized, close the uppermost
            // maximized window if the option to only control maximized windows
            // is set
            } else if (onlymax) {
                let uppermax = this._upperMax();
                if (uppermax) {
                    uppermax.delete(global.get_current_time());
                    activeWindow.activate(global.get_current_time());
                } else {
                    // If no maximized windows, close the active window
                    activeWindow.delete(global.get_current_time());
                }
            // Otherwise close the active window
            } else {
                activeWindow.delete(global.get_current_time());
            }
        }
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

    enable: function () {
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
        this._settings.connect('changed::' + WA_DO_METACITY,
                Lang.bind(this, this._loadTheme));
        this._settings.connect('changed::' + WA_THEME,
                Lang.bind(this, this._loadTheme));
        this._settings.connect('changed::' + WA_ORDER,
                Lang.bind(this, this._display));
        this._settings.connect('changed::' + WA_PINCH,
                Lang.bind(this, this._display));
        this._settings.connect('changed::' + WA_HIDEONNOMAX,
                Lang.bind(this, this._windowChanged));

        this._settings.connect('changed::' + WA_LEFTPOS, Lang.bind(this,
                    this._onPositionChange, WA_LEFTPOS, WA_LEFTBOX));
        this._settings.connect('changed::' + WA_RIGHTPOS, Lang.bind(this,
                    this._onPositionChange, WA_RIGHTPOS, WA_RIGHTBOX));

        this._settings.connect('changed::' + WA_LEFTBOX, Lang.bind(this,
                    this._onPositionChange, WA_LEFTPOS, WA_LEFTBOX));
        this._settings.connect('changed::' + WA_RIGHTBOX, Lang.bind(this,
                    this._onPositionChange, WA_RIGHTPOS, WA_RIGHTBOX));

        // Connect to window change events
        this._wmSignals = [];
        this._windowTrackerSignal = Shell.WindowTracker.get_default().connect(
                'notify::focus-app', Lang.bind(this, this._windowChanged));
        this._wmSignals.push(global.window_manager.connect('switch-workspace',
            Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('minimize',
			Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('maximize',
			Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('unmaximize',
			Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('map',
			Lang.bind(this, this._windowChanged)));
        this._wmSignals.push(global.window_manager.connect('destroy',
			Lang.bind(this, this._windowChanged)));

        let leftbox = this._settings.get_enum(WA_LEFTBOX),
            rightbox = this._settings.get_enum(WA_RIGHTBOX),
            leftpos = this._settings.get_int(WA_LEFTPOS),
            rightpos = this._settings.get_int(WA_RIGHTPOS);

        this._leftContainer = getBox(leftbox);
        this._rightContainer = getBox(rightbox);

        // A delay is needed to let all the other icons load first.
        Mainloop.idle_add(Lang.bind(this, function () {
            this._leftContainer.insert_child_at_index(this.leftActor,
                    getPosition(this._leftContainer, leftpos,
                        getNChildren(this._leftContainer)));
            this._rightContainer.insert_child_at_index(this.rightActor,
                    getPosition(this._rightContainer,
                        rightpos, getNChildren(this._rightContainer)));
            return false;
        }));

        // Show or hide buttons
        this._windowChanged();
    },

    disable: function () {
        this._leftContainer.remove_actor(this.leftActor);
        this._rightContainer.remove_actor(this.rightActor);

        /* disconnect all signals */
        this._settings.disconnectAll();
        Shell.WindowTracker.get_default().disconnect(this._windowTrackerSignal);
        for (let i = 0; i < this._wmSignals; ++i) {
            global.window_manager.disconnect(this._wmSignals.pop());
        }
    }
};

function init(extensionMeta) {
    extensionPath = extensionMeta.path;
    return new WindowButtons();
}
