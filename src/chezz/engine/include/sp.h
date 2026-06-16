/* Header file for sliding piece move generation in the Chezz game engine. */

#ifndef SP_H
#define SP_H

#include "chezz.h"

/* Defines the file path for precomputed sliding piece magic tables. */
#define MAGIC_TABLE_FILE "src/sliding_pieces/sp_table.dat"

/* Structs for magic tables and attack tables for bishops and rooks. */
typedef struct {
    Bitboard magic_number;                      // magic number for hashing blocker positions
    Bitboard mask;                              // bitmask for relevant squares
    Bitboard attack_table[MAX_BISHOP_ATTACKS];  // precomputed attack table
    int relevant_bits;                          // num relevant bits for hashing
} BishopMagicTable;

typedef struct {
    Bitboard magic_number;                    // magic number for hashing blocker positions
    Bitboard mask;                            // bitmask for relevant squares
    Bitboard attack_table[MAX_ROOK_ATTACKS];  // precomputed attack table
    int relevant_bits;                        // num relevant bits for hashing
} RookMagicTable;


/* Arrays storing max number of blockers for bishops and rooks at each square. */
extern const int BISHOP_RELEVANT_BITS[TOTAL_SQUARES];
extern const int ROOK_RELEVANT_BITS[TOTAL_SQUARES];

/* Magic tables for bishop and rook moves. */
extern BishopMagicTable bishop_magics[TOTAL_SQUARES];
extern RookMagicTable rook_magics[TOTAL_SQUARES];

/* Temp storage for generating magic tables. */
extern BishopMagicTable bishop_magics_temp[TOTAL_SQUARES];
extern RookMagicTable rook_magics_temp[TOTAL_SQUARES];


/* Function declarations for gen_sp_tables.c. */
void init_magic_tables();                                                 // init magic tables
void compute_magic_attack_tables();                                       // compute attack tables
Bitboard gen_blocker_config(int index, int num_bits, Bitboard mask);      // gen blocker config
Bitboard gen_bishop_attacks(int square, Bitboard blockers);               // gen bishop attacks
Bitboard gen_rook_attacks(int square, Bitboard blockers);                 // gen rook attacks
Bitboard gen_random_magic();                                              // gen random magic number
Bitboard find_magic_number(int square, int relevant_bits, int is_bishop); // find magic number
void gen_magic_numbers(int is_bishop);                                    // gen magic numbers
void save_magic_tables();                                                 // save magic tables to file
void load_magic_tables();                                                 // load magic tables from file
void export_magic_table(int is_bishop);                                   // export magic table to .c file


/* Function declarations for sp_masks.c. */
Bitboard gen_bishop_mask(int square);  // gen bishop mask
Bitboard gen_rook_mask(int square);    // gen rook mask
Bitboard gen_queen_mask(int square);   // gen queen mask

/* Function declarations for gen_sp_tables.c (attack bitboards). */
Bitboard bishop_attacks(int square, Bitboard blockers);  // get bishop attacks
Bitboard rook_attacks(int square, Bitboard blockers);    // get rook attacks
Bitboard queen_attacks(int square, Bitboard blockers);   // get queen attacks

/* Function declarations for test_sp_tables.c. */
void verify_unique_magic_mappings();  // verify unique mappings
void print_attack_table_sizes();      // print table sizes
void summarize_attack_bitboards();    // summarize attack bitboards


#endif // SP_H