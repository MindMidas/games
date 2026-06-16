CC = clang
CFLAGS = -Wall -pedantic -std=c99 -fPIC
PYTHON ?= python3
PY_INCLUDES := $(shell $(PYTHON)-config --includes 2>/dev/null)
PY_LDFLAGS := $(shell $(PYTHON)-config --ldflags 2>/dev/null)

ifeq ($(strip $(PY_INCLUDES)),)
$(error Could not find python3-config; install Python development headers.)
endif

UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
  EXT_LDFLAGS = -undefined dynamic_lookup
else
  EXT_LDFLAGS =
endif

.PHONY: all clean

all: libphylib.so _phylib.so phylib_wrap.o phylib_wrap.c phylib.py

phylib.o: phylib.c phylib.h
	$(CC) $(CFLAGS) -c phylib.c -o phylib.o

libphylib.so: phylib.o
	$(CC) $(CFLAGS) phylib.o -shared -o libphylib.so -lm

phylib_wrap.c phylib.py: phylib.i
	swig -python phylib.i

phylib_wrap.o: phylib_wrap.c
	$(CC) $(CFLAGS) -c phylib_wrap.c $(PY_INCLUDES) -fPIC -o phylib_wrap.o

_phylib.so: phylib_wrap.o libphylib.so
	$(CC) $(CFLAGS) -shared phylib_wrap.o -L. $(PY_LDFLAGS) $(EXT_LDFLAGS) -lphylib -o _phylib.so

clean:
	rm -f *.so *.o *.out *.exe *.svg phylib_wrap.c phylib.py phylib.db
