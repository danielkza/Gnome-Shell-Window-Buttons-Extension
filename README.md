Window Buttons Extension
================================
This is an extension for Gnome 3 which puts minimize, maximize and close buttons in the top panel.
Supports custom button layouts and css theming!

<table>
  <tr>
    <td><img src="https://raw.github.com/danielkza/Gnome-Shell-Window-Buttons-Extension/master/screenshot.png" alt="Screenshot" /></td>
  </tr>
  <tr>
    <td>Current (06/Jun/2013) themes, top-to-bottom: Ambiance-Blue, Ambiance, default, Radiance, UniMetro-Black, UniMetro, Zukitwo-Dark, Zukitwo</td>
  </tr>
</table>

Configure with `gnome-shell-extension-prefs` or GNOME Tweak Tool.

**Original Author**: biox (Josiah Messiah)  
**Maintainer**: Daniel Miranda <danielkza2@gmail.com>  
**Previous Maintainer**: mathematical.coffee <mathematical.coffee@gmail.com>  
**Contributors**: [Many (thankyou!)](https://github.com/danielkza/Gnome-Shell-Window-Buttons-Extension/contributors)

Installation
------------
Install it from [extensions.gnome.org](https://extensions.gnome.org/extension/960/window-buttons/).

If you wish to install manually, follow the steps below.

### GNOME 3.12-3.16

Checkout the master branch, by doing:

```bash
git clone https://github.com/danielkza/Gnome-Shell-Window-Buttons-Extension.git
cd Gnome-Shell-Window-Buttons-Extension
git checkout master
make # <-- very important!
# symlink to extensions directory
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$PWD/window_buttons@danielkza.github.com" ~/.local/share/gnome-shell/extensions/
# install
gnome-shell-extension-tool -e window_buttons@danielkza.github.com 
```

### Other GNOME versions

No longer supported, sorry!

Configuration
-------------
The following is an explanation of the configuration options available.

### Button order
This is the order of the buttons, for example minimize then maximize then close, or close then maximize then minimize.
There are two settings that affect this: `order` and `pinch`.

The `pinch` setting is whether you want to pinch the order of the buttons from Metacity or Gnome shell:

* `PinchType.METACITY` means the order will be taken from the key `/apps/metacity/general/button_layout`,
* `PinchType.GNOME_SHELL` takes the order from `/org/gnome/shell/overrides/button-layout`,
* `PinchType.CUSTOM` means you'll specify the order yourself.

If you choose `PinchType.CUSTOM`, then you have to specify `order`.

`order` is a string (default `':minimize, maximize, close'`) specifying button order.
The available buttons are 'minimize', 'maximize', and 'close', separated by a comma.

The colon `:` splits the buttons into two groups: left and right.
These can be positioned separately. For example, `minimize:maximize, close` will allow you to position the 'minimize' button separately to the 'maximize, close' buttons.

### Themes
What theme to use for the buttons.
There are two settings that control what theme is used: `doMetacity` and `theme`.

If `doMetacity` is set to `true`, window buttons will use whatever theme is in `/apps/metacity/general/theme` (if we have a matching theme). Otherwise, we we will use the `theme` setting to determine which theme to use.

Themes are stored in the `themes` directory of this extension, for example `~/.local/share/gnome-shell/extensions/window_butons@danielkza.github.com/themes`.
You must set the `theme` to one of these names.
For further details see the 'Themes' section below.

### When the buttons appear.
By default, the window buttons will be visible all the time *unless* you have no windows on your workspace, in which case they hide.

You can change this with the `showbuttons` setting.

* `ShowButtonsWhen.ALWAYS` means the buttons will be shown all the time, even if there are no windows on the workspace.
* `ShowButtonsWhen.WINDOWS` (the default) means the buttons will be shown if and only if there are windows on the workspace.
* `ShowButtonsWhen.WINDOWS_VISIBLE` means the buttons will be shown if and only if there are *visible* (i.e. non-minimized) windows on the workspace.
* `ShowButtonsWhen.CURRENT_WINDOW_MAXIMIZED` means the buttons will be shown if and only if the current window is maximized.
* `ShowButtonsWhen.ANY_WINDOW_MAXIMIZED` means the buttons will be shown if and only if there are *any* *maximized* windows on the workspace. In this case, clicking on a window button will control the **uppermost maximized window** which is **not necesserily the current window!**.

### Positioning the buttons in the panel
Recall you can position the left and right groups of buttons separately (determined by the colon ':' in `order`).

Use `gnome-shell-extension-prefs` for the positioning - it's easier.

The position of a button group is determined by two factors: what *box* it is in, and what *position* it has *within that box*.

For the box:

* `Boxes.LEFT` means in the left box (usually holds the activities and
  window title buttons)
* `Boxes.MIDDLE` means the centre box (usually holds the date/time, unless
  you have an extension that moves the clock to the right for you).
* `Boxes.RIGHT` means the right box (status area, user menu).

The position is a number representing whereabouts in the box you want the buttons to be.

For example `1` means 'first item from the left', `2` means 'second item from the left' and so on. If you want to anchor from the right, use a negative number: `-1` means 'first item from the right' and so on.

Themes
------
The Window Buttons extension is themeable.
Themes live in the `themes`. The name of the directory is the name of the theme.

If you want to make your own theme, you have to add a folder into the `themes` directory.
To start off, copy the `default` theme:

    cd window_buttons@danielkza.github.com/themes
    cp -r default my_new_theme 

Then, edit the `style.css` file to style the window buttons. 
At a bare minimum, you need to define styles for `.window-button`, `.minimize`, `.maximize` and `.close`.

The `.window-button` style affects each individual button.
The `.minimize`, `.maximize` and `.close` styles define the styles for each individual button.
You will have to do something like

    background-img: url("path/to/picture")

for each button, and the picture should have the symbol for the button in it (i.e. we do not draw `_`, `X`, etc on the buttons).

See `themes/default/style.css` for more information.

Also, feel free to add a file `ABOUT` with credits/information.

(The 'screenshot.png' image displayed on this readme was generated using ImageMagick:

    convert -background black -gravity center -append `find window_buttons@danielkza.github.com/themes -iname screenshot.png | sort` screenshot.png

)

Changelog
---------
v20 on e.g.o (GNOME 3.16, fork by danielkza from mathematicalcofee, dev-version 2.4)

* fix compatibility with GNOME 3.16

v11 on e.g.o (GNOME 3.8), dev-version 2.3.1:

* fix bug where activities button would drift to the right upon lock/unlock (#18)

v10 on e.g.o (GNOME 3.4, 3.6, 3.8), dev-version 2.3:

* GNOME 3.8 support added
* maximized windows that are minimized shouldn't count towards WINDOWS_MAXIMIZED (#9; deadalnix)
* fixed phantom space when no buttons are showing (#10; deadalnix)
* new themes UniMetro and UniMetro-Dark (jsjinga)

v7/8/9 on e.g.o:

* quick fixes to get disable/re-enable working
* typos

v5/v6 on e.g.o:

* Buttons hide in the Overview (cfclavijo; #6)
* New theme Ambiance-Blue (cfclavijo; #6)

v3/v4 on e.g.o:

* Add hover style for the 'default' theme (#4)
* Fix bug in `do-metacity` option preventing extension enablement on 3.4.1 (#3)
* "Maximized" windows means fully-maximized (not half-maximized) (#1)
* Added more options for when the buttons show (#2)

To-do
-----

- Add unfocused window support for better theming
- Modify themes so that we handle drawing the icon and only the background image need be provided?
- Moar themes!

Version map
-----------
For 'version', see 'version' in metadata.json (this is the version of the extension as it appears/is planned for on extensions.gnome.org).

- v1, v3: GNOME 3.2-compatible.
- v2, v4: GNOME 3.4-compatible.
