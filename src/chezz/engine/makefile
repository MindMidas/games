# compiler
CC      = gcc

# flags
CFLAGS  = -Wall -Wextra -std=c11 -pthread

# paths for headers
CFLAGS += -Iinclude -Idebug

# exec
TARGET  = main
ifeq ($(OS),Windows_NT)
	SHARED_TARGET = user_actions.dll
	SHARED_LDFLAGS = -shared
	BUILD_MAIN = 0
else
	UNAME_S := $(shell uname -s)
	BUILD_MAIN = 1
	ifeq ($(UNAME_S),Darwin)
		SHARED_TARGET = libuser_actions.dylib
		SHARED_LDFLAGS = -dynamiclib
	else
		SHARED_TARGET = libuser_actions.so
		SHARED_LDFLAGS = -shared
		CFLAGS += -fPIC
	endif
endif

# source files for executable only
MAIN_SRCS = \
    src/main.c

# source files shared by executable and DLL
COMMON_SRCS = \
    src/gen_valid_boards.c \
    src/user_actions.c \
    debug/debugging.c \
    src/non_sliding_pieces/gen_nsp_tables.c \
    src/non_sliding_pieces/nsp_masks.c \
    src/non_sliding_pieces/nsp_table.c \
    src/sliding_pieces/gen_sp_tables.c \
    src/sliding_pieces/get_sp_attacks.c \
    src/sliding_pieces/sp_masks.c \
    src/sliding_pieces/test_sp_tables.c \
    src/sliding_pieces/rook_magic.c \
    src/sliding_pieces/bishop_magic.c \
    src/negamax/zobrist_table.c \
    src/negamax/tt.c \
    src/negamax/manage_search.c \
    src/negamax/negamax.c \
    src/negamax/eval/eval.c \
    src/negamax/eval/move_ordering_eval.c \
    src/negamax/eval/heuristics/material_eval.c \
    src/negamax/eval/heuristics/peons_struct_eval.c \
    src/negamax/eval/heuristics/pos_eval.c \
    src/negamax/eval/heuristics/king_safety_eval.c \
    src/negamax/eval/heuristics/piece_safety_eval.c \
    src/negamax/eval/heuristics/mobility_eval.c

# source files used by DLL only
LIB_SRCS = \
    src/shared_core.c \
    src/engine_api.c \
    $(COMMON_SRCS)

# object files
MAIN_OBJS = $(MAIN_SRCS:.c=.o)
COMMON_OBJS = $(COMMON_SRCS:.c=.o)
LIB_OBJS = $(LIB_SRCS:.c=.o)
OBJS = $(MAIN_OBJS) $(COMMON_OBJS) $(LIB_OBJS)

# headers
HEADERS = \
    include/chezz.h \
    include/nsp.h \
    include/sp.h \
    include/gen_valid_boards.h \
    include/user_actions.h \
    include/tt.h \
    include/manage_search.h \
    include/negamax.h \
    include/eval.h \
    include/move_ordering_eval.h \
    include/material_eval.h \
    include/peons_struct_eval.h \
    include/pos_eval.h \
    include/king_safety_eval.h \
    include/piece_safety_eval.h \
    include/mobility_eval.h \
    debug/debug.h

# default rule 
ifeq ($(BUILD_MAIN),1)
all: $(TARGET) run $(SHARED_TARGET)
else
all: $(SHARED_TARGET)
endif

# link step for main exec
$(TARGET): $(MAIN_OBJS) $(COMMON_OBJS)
	$(CC) $(CFLAGS) -o $(TARGET) $(MAIN_OBJS) $(COMMON_OBJS)

$(SHARED_TARGET): $(LIB_OBJS)
	$(CC) $(CFLAGS) $(SHARED_LDFLAGS) -o $(SHARED_TARGET) $(LIB_OBJS)

# pattern rule to build .o from .c
%.o: %.c $(HEADERS)
	$(CC) $(CFLAGS) -c $< -o $@

# clean rule
clean:
	rm -f $(OBJS) $(TARGET) $(SHARED_TARGET) run *.o \
	      user_actions.dll libuser_actions.so libuser_actions.dylib \
	      src/non_sliding_pieces/*.o \
	      src/sliding_pieces/*.o \
          src/negamax/*.o \
          src/negamax/eval/*.o \
          src/negamax/eval/heuristics/*.o \
	      debug/*.o \
          tt.dat 

# create run script/exec
run: $(TARGET)
	echo "#!/bin/bash\n./$(TARGET) \"\$$@\" > board.out" > run
	chmod +x run
