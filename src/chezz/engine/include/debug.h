/* Header file for debugging utilities in the Chezz game engine. */

#ifndef DEBUG_H
#define DEBUG_H

#include "chezz.h"
#include "tt.h"

/* Function declarations for debugging.c. */
void print_bitboard(Chezzboard *board);             // print the bitboard in a readable 64-bit binary format
void print_chezz_board(Chezzboard *board);          // print the Chezz board in a readable format
void print_bitboard_state(Bitboard bitboard);       // print a single bitboard in a chezz board format
void print_chezzboard_to_file(Chezzboard *board,
                              double elapsed_time); // print chezz board to game.out

#endif // DEBUG_H