/* Header file for non-sliding piece move generation in the Chezz game engine. */

#ifndef NSP_H
#define NSP_H

#include "chezz.h"

/* Defines the file path for precomputed non-sliding piece moves. */
#define NSP_TABLE_FILE "src/non_sliding_pieces/nsp_table.dat"

/* External table of all possible moves for non-sliding pieces. */
extern Bitboard nsp_table[TOTAL_TYPES][TOTAL_SQUARES];

/* Temporary storage for generating the NSP table initially. */
extern Bitboard nsp_table_temp[TOTAL_TYPES][TOTAL_SQUARES];

/* Function declarations for gen_nsp_tables.c. */
void gen_nsp_table();      // generate moves and save to file
void load_nsp_table();     // load moves from file
void export_nsp_table();   // export moves to a .c file

/* Function declarations for nsp_mask.c. */
Bitboard gen_peon_mask(int square, int direction);  // gen peon moves
Bitboard gen_knight_mask(int square);               // gen knight moves
Bitboard gen_king_mask(int square);                 // gen king moves
Bitboard gen_zombie_mask(int square);               // gen zombie moves
Bitboard gen_catapult_mask(int square);             // gen catapult moves
Bitboard gen_canon_mask(int square);                // gen canon moves


#endif // NSP_H