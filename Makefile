#=============================================================================
UUID=window_buttons@danielkza.github.com
FILES=metadata.json *.js stylesheet.css schemas themes
#=============================================================================
default_target: all
.PHONY: clean all zip

clean:
	@rm -f $(UUID).zip $(UUID)/schemas/gschemas.compiled

# compile the schemas
all: clean
	@if [ -d $(UUID)/schemas ]; then \
		glib-compile-schemas $(UUID)/schemas; \
	fi

# to put on the Downloads page
zip: all
	zip -rq $(UUID).zip $(FILES:%=$(UUID)/%)

# to upload to e.g.o
dev-zip: all
	(cd $(UUID); \
		zip -rq ../$(UUID).zip $(FILES))
