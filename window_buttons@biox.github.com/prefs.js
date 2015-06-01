/*global log, global */ // <-- for jshint
/** Credit:
 *  based off prefs.js from the gnome shell extensions repository at
 *  git.gnome.org/browse/gnome-shell-extensions
 */

const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Lang = imports.lang;

const ExtensionUtils = imports.misc.extensionUtils;
const Params = imports.misc.params;

const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
let extensionPath = Me.path;

// Settings
const WA_PINCH = 'pinch';
const WA_ORDER = 'order';
const WA_THEME = 'theme';
const WA_DO_METACITY = 'do-metacity';
const WA_LEFTBOX = 'box-left';
const WA_LEFTPOS = 'position-left';
const WA_RIGHTBOX = 'box-right';
const WA_RIGHTPOS = 'position-right';
const WA_SHOWBUTTONS = 'show-buttons';
const WA_HIDEINOVERVIEW = 'hide-in-overview';

// Keep enums in sync with GSettings schemas
const PinchType = {
    CUSTOM: 0,
    METACITY: 1,
    GNOME_SHELL: 2
};

// Which box to place things in.
const Boxes = {
    LEFT: 0,
    RIGHT: 1,
    MIDDLE: 2
};

// When to display the buttons.
const ShowButtonsWhen = {
    ALWAYS: 0,                    // Show buttons all the time.
    WINDOWS: 1,                   // Show buttons whenever windows exist
                                  //  (hides when no apps open)
    WINDOWS_VISIBLE: 2,           // Show buttons whenever *visible* windows
                                  //  exist (as previous, but will also hide if
                                  //  all windows are minimized)
    CURRENT_WINDOW_MAXIMIZED: 3,  // Show buttons only when the current window
                                  //  is maximized.
    ANY_WINDOW_MAXIMIZED: 4,      // Show buttons when there is *any* maximized
                                  //  window (in which case the uppermost
                                  //  maximized window will be affected, which
                                  //  may or may not be the current window!)
    ANY_WINDOW_FOCUSED: 5         // Only show buttons when a window is focused
                                  // (e.g. no window is focused if Nautilus is
                                  // managin the desktop and it is selected)
};

/* **** HELPER FUNCTIONS *** */
function cycleBox(boxEnum, forward) {
    let nextBox = boxEnum;
    switch (boxEnum) {
    case Boxes.LEFT:
        nextBox = (forward ? Boxes.MIDDLE : Boxes.LEFT);
        break;
    case Boxes.MIDDLE:
        nextBox = (forward ? Boxes.RIGHT : Boxes.LEFT);
        break;
    case Boxes.RIGHT:
        nextBox = (forward ? Boxes.RIGHT : Boxes.MIDDLE);
        break;
    }
    return nextBox;
}

/* **** prefs.js *** */

function init() {
}

const WindowButtonsPrefsWidget = new GObject.Class({
    Name: 'WindowButtons.Prefs.Widget',
    GTypeName: 'WindowButtonsPrefsWidget',
    Extends: Gtk.Grid,

    _init: function (params) {
        this.parent(params);
        this.margin = this.row_spacing = this.column_spacing = 10;
        this._rownum = 0;
        this._settings = Convenience.getSettings();

        Gtk.Settings.get_default().gtk_button_images = true;

        // themes: look in extensionPath/themes
        let info,
            item = new Gtk.ComboBoxText(),
            themes_dir = Gio.file_new_for_path(
                GLib.build_filenamev([extensionPath, 'themes'])
            ),
            fileEnum = themes_dir.enumerate_children('standard::*',
                    Gio.FileQueryInfoFlags.NONE, null);

        while ((info = fileEnum.next_file(null)) !== null) {
            let theme = info.get_name();
            if (GLib.file_test(GLib.build_filenamev([themes_dir.get_path(),
                    theme, 'style.css']), GLib.FileTest.EXISTS)) {
                item.append(theme, theme);
            }
        }
        fileEnum.close(null);

        item.connect('changed', Lang.bind(this, function (combo) {
            let value = combo.get_active_id();
            if (value !== undefined &&
                this._settings.get_string(WA_THEME) !== value) {
                this._settings.set_string(WA_THEME, value);
            }
        }));
        item.set_active_id(this._settings.get_string(WA_THEME) || 'default');
        this.addRow("Which theme to use:", item);
        this._themeCombo = item;

        // doMetacity
        this._doMetacity = this.addBoolean("Match Metacity theme if possible\n" +
            " (/apps/metacity/general/theme, OVERRIDES above theme)",
            WA_DO_METACITY);
        this._doMetacity.connect('notify::active', Lang.bind(this, function () {
            this._themeCombo.set_sensitive(!this._doMetacity.active);
        }));
        this._themeCombo.set_sensitive(!this._doMetacity.active);

        // pinch
        item = new Gtk.ComboBoxText();
        for (let type in PinchType) {
            if (PinchType.hasOwnProperty(type)) {
                let label = type[0].toUpperCase() +
                    type.substring(1).toLowerCase();
                label = label.replace(/_/g, '-');
                item.insert(-1, PinchType[type].toString(), label);
            }
        }
        item.set_active_id(this._settings.get_enum(WA_PINCH).toString());
        item.connect('changed', Lang.bind(this, function (combo) {
            let value = parseInt(combo.get_active_id(), 10);
            if (value !== undefined &&
                this._settings.get_enum(WA_PINCH) !== value) {
                this._settings.set_enum(WA_PINCH, value);
            }
            this._order.set_sensitive(value === PinchType.CUSTOM);
        }));
        this.addRow("Which button order to use:", item);

        // order
        this._order = this.addEntry("Button order:\n(allowed: {'minimize', " +
                "'maximize', 'close', ':'})", WA_ORDER);
        this._order.set_sensitive(
                this._settings.get_enum(WA_PINCH) === PinchType.CUSTOM
        );
        /* insert controls for moving buttons */
        this._positionLeft = this._makeLeftRightButtons(
                "Position the left set of buttons", WA_LEFTBOX, WA_LEFTPOS);
        this._positionRight = this._makeLeftRightButtons(
                "Position the right set of buttons", WA_RIGHTBOX, WA_RIGHTPOS);
        // disable if no left or right set of buttons to move.
        let lr = this._order.text.split(':');
        if (lr.length !== 1) {
            this._positionLeft.set_sensitive(lr[0].length);
            this._positionRight.set_sensitive(lr[1].length);
        }

        this._order.connect('notify::text', Lang.bind(this, function () {
            if (lr.length !== 1) {
                this._positionLeft.set_sensitive(lr[0].length);
                this._positionRight.set_sensitive(lr[1].length);
            }
        }));

        // hide in overview?
        this.addBoolean("Hide buttons in the overview?", WA_HIDEINOVERVIEW);

        // when to display the buttons (show-buttons)
        item = new Gtk.ComboBoxText();
        let explanations = {
                ALWAYS: "buttons will be shown all the time.",
                WINDOWS: "buttons will be shown if and only if there are " +
                         "windows on the workspace.",
                WINDOWS_VISIBLE: "buttons will be shown if and only if there " +
                                 "are *visible* (i.e. non-minimized) windows " +
                                 "on the workspace.",
                CURRENT_WINDOW_MAXIMIZED: "buttons will be shown if and only " +
                                          "if the current window is maximized.",
                ANY_WINDOW_MAXIMIZED: "buttons will be shown if and only if " +
                                      "there are *any* *maximized* windows on" +
                                      " the workspace. In this case, clicking" +
                                      " on a window button will control the " +
                                      "**uppermost maximized window** which " +
                                      "is **not necessarily the current " +
                                      "window!**.",
                ANY_WINDOW_FOCUSED: "buttons will be shown if and only if " +
                                    "a window is focused. For example if you " +
                                    "have Nautilus managing the desktop and " +
                                    "click on it, you will have no focused " +
                                    "windows so the buttons will hide."
                    
            };
        this.addRow("When should the buttons appear?", item);
        let grid = new Gtk.Grid({column_spacing: 10}),
            expander = new Gtk.Expander({
                label: "Explanation of show-button modes"
            });
        grid._rownum = 0;
        for (let type in ShowButtonsWhen) {
            if (!ShowButtonsWhen.hasOwnProperty(type)) {
                continue;
            }
            let label = type.toLowerCase().replace(/_/g, ' ');
            item.append(ShowButtonsWhen[type].toString(), label);

            let label2 = new Gtk.Label({
                label: label + ':'
            });
            let explan = new Gtk.Label({
                label: explanations[type],
                hexpand: true,
                halign: Gtk.Align.START
            });
            label2.set_alignment(0, 0);
            explan.set_alignment(0, 0);
            explan.set_line_wrap(true);
            grid.attach(label2, 0, grid._rownum, 1, 1);
            grid.attach(explan, 1, grid._rownum, 1, 1);
            grid._rownum++;
        }
        item.set_active_id(this._settings.get_enum(WA_SHOWBUTTONS).toString());
        item.connect('changed', Lang.bind(this, function (combo) {
            let value = parseInt(combo.get_active_id(), 10);
            if (value !== undefined &&
                this._settings.get_enum(WA_SHOWBUTTONS) !== value) {
                this._settings.set_enum(WA_SHOWBUTTONS, value);
            }
        }));
        expander.add(grid);
        this.addItem(expander);
    },

    /* insert controls for moving buttons */
    _makeLeftRightButtons: function (label, boxKey, positionKey) {
        // EXAMPLES:
        // Put as the right-most item in the status bar:
        //     box: Boxes.RIGHT,
        //     position: -1
        // Put as the left-most item in the status bar:
        //     box: Boxes.RIGHT,
        //     position: 1
        // Put right after the title-bar:
        //     box: Boxes.LEFT,
        //     position: -1
        // Put in before the title-bar (between 'Activities' and the title bar):
        //     box: Boxes.LEFT,
        //     position: 2
        let hgrid = new Gtk.Grid({column_homogeneous: true}),
            item = Gtk.Button.new_from_stock(Gtk.STOCK_GO_BACK);
        item.connect('clicked', Lang.bind(this, function () {
            let pos = this._settings.get_int(positionKey) - 1,
                box = this._settings.get_enum(boxKey),
                newBox = cycleBox(box, false);

            if (pos === 0 && box === newBox) {
                // no change
                return;
            }

            this._settings.set_int(positionKey, pos);

            // We go through the front of a box into the previous one:
            // send a new box change and then a new position change.
            if (pos === 0) {
                // cycle through to the previous box.
                this._settings.set_enum(boxKey, newBox);
                this._settings.set_int(positionKey, -1);
            }
        }));
        hgrid.attach(item, 0, 0, 1, 1); // col, row, colspan, rowspan
        item = Gtk.Button.new_from_stock(Gtk.STOCK_GO_FORWARD);
        item.connect('clicked', Lang.bind(this, function () {
            let pos = this._settings.get_int(positionKey) + 1,
                box = this._settings.get_enum(boxKey),
                newBox = cycleBox(box, true);

            if (pos === 0 && box === newBox) {
                return;
            } // no change

            this._settings.set_int(positionKey, pos);

            // We go through the end of a box into the next one:
            // send a new box change and then a new position change.
            if (pos === 0) {
                // cycle through to the previous box.
                this._settings.set_enum(boxKey, newBox);
                this._settings.set_int(positionKey, 1);
            }
        }));
        hgrid.attach(item, 1, 0, 1, 1);
        return this.addRow(label, hgrid);
    },

    addEntry: function (text, key) {
        let item = new Gtk.Entry({ hexpand: true });
        item.text = this._settings.get_string(key);
        this._settings.bind(key, item, 'text', Gio.SettingsBindFlags.DEFAULT);
        return this.addRow(text, item);
    },

    addBoolean: function (text, key) {
        let item = new Gtk.Switch({active: this._settings.get_boolean(key)});
        this._settings.bind(key, item, 'active', Gio.SettingsBindFlags.DEFAULT);
        return this.addRow(text, item);
    },

    addSpin: function (label, key, adjustmentProperties, spinProperties) {
        adjustmentProperties = Params.parse(adjustmentProperties,
            { lower: 0, upper: 100, step_increment: 100 });
        let adjustment = new Gtk.Adjustment(adjustmentProperties);
        spinProperties = Params.parse(spinProperties,
            { adjustment: adjustment, numeric: true, snap_to_ticks: true },
            true
        );
        let spinButton = new Gtk.SpinButton(spinProperties);

        spinButton.set_value(this._settings.get_int(key));
        spinButton.connect('value-changed', Lang.bind(this, function (spin) {
            let value = spin.get_value_as_int();
            if (this._settings.get_int(key) !== value) {
                this._settings.set_int(key, value);
            }
        }));
        return this.addRow(label, spinButton, true);
    },

    addRow: function (text, widget, wrap) {
        let label = new Gtk.Label({
            label: text,
            hexpand: true,
            halign: Gtk.Align.START
        });
        label.set_line_wrap(wrap || false);
        this.attach(label, 0, this._rownum, 1, 1); // col, row, colspan, rowspan
        this.attach(widget, 1, this._rownum, 1, 1);
        this._rownum++;
        return widget;
    },

    addItem: function (widget, col, colspan, rowspan) {
        this.attach(widget, col || 0, this._rownum, colspan || 2, rowspan || 1);
        this._rownum++;
        return widget;
    }
});

function buildPrefsWidget() {
    let widget = new WindowButtonsPrefsWidget();
    widget.show_all();

    return widget;
}
