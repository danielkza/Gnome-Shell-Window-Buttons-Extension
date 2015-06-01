#=============================================================================
UUID=window_buttons@biox.github.com
FILES=metadata.json *.js stylesheet.css schemas themes
#=============================================================================

all: .all
.all: $(UUID)/schemas/gschemas.compiled $(addprefix $(UUID)/,$(FILES))
	touch .all

.PHONY: clean all zip dev-zip

clean:
	@rm -f .all $(UUID).zip $(UUID)-release.zip $(UUID)/schemas/gschemas.compiled

$(UUID)/schemas/gschemas.compiled: $(UUID)/schemas/*.gschema.xml
	glib-compile-schemas $(UUID)/schemas

# to put on the Downloads page
$(UUID)-release.zip: .all
	zip -rq $(UUID)-release.zip $(FILES:%=$(UUID)/%)

zip: $(UUID)-release.zip

# to upload to e.g.o
$(UUID).zip: .all
	(cd $(UUID); zip -rq ../$(UUID).zip $(FILES))

dev-zip: $(UUID).zip
