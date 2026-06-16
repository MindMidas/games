/*
 * Main header file for the Chezz game engine, defining core types, constants, and function declarations.
 */

#ifndef CHEZZ_H
#define CHEZZ_H

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <time.h>
#include <unistd.h>
#include <inttypes.h>
#include <sys/time.h>

#ifdef _WIN32
#define CHEZZ_API __declspec(dllexport)
#else
#define CHEZZ_API
#endif


/* Defines total number of piece types (white and black). */
#define TOTAL_TYPES 18

/* Defines total number of squares on the Chezz board (8x8). */
#define TOTAL_SQUARES 64

/* Max number of rook attack table entries (2^12 states). */
#define MAX_ROOK_ATTACKS 4096

/* Max number of bishop attack table entries (2^9 states). */
#define MAX_BISHOP_ATTACKS 512

/*
 * Max number of legal moves per position (placeholder from chess, to be updated for Chezz).
 */
#define MAX_LEGAL_MOVES 218

/* Defines player turn identifiers. */
#define WHITE 'w'
#define BLACK 'b'


/* Defines the max score value representing infinity. */
#define INFINITY 1000000


/* Defines bitboard masks for board columns. */
#define COL_A 0x0101010101010101ULL  // column A
#define COL_H 0x8080808080808080ULL  // column H

/* Defines Bitboard as an alias for uint64_t to represent 64-bit board states. */
typedef uint64_t Bitboard;

/* Lookup table mapping precomputed row masks for convenience (row 0 lowest) */
extern const Bitboard row_masks[8];


/* Lookup table mapping precomputed col masks (col 0 lowest) */
extern const Bitboard col_masks[8];


/* Enumerates squares on the Chezz board (0-63) for bitboard indexing. */
typedef enum {
    A1, B1, C1, D1, E1, F1, G1, H1,
    A2, B2, C2, D2, E2, F2, G2, H2,
    A3, B3, C3, D3, E3, F3, G3, H3,
    A4, B4, C4, D4, E4, F4, G4, H4,
    A5, B5, C5, D5, E5, F5, G5, H5,
    A6, B6, C6, D6, E6, F6, G6, H6,
    A7, B7, C7, D7, E7, F7, G7, H7,
    A8, B8, C8, D8, E8, F8, G8, H8
} Square;


/* Lookup table mapping square indices to algebraic notation (ex: "A1"). */
extern const char *square_lookup[TOTAL_SQUARES];


/* Enumerates piece types for fast lookup and bitboard indexing. */
typedef enum {
    WP, BP, // Peons
    WN, BN, // Knights
    WB, BB, // Bishops
    WR, BR, // Rooks
    WQ, BQ, // Queens
    WK, BK, // Kings
    WZ, BZ, // Zombies
    WF, BF, // Catapults
    WC, BC, // Canons
    INVALID_PIECE = -1 // Default invalid case
} PieceType;


/* Lookup table mapping piece type indices to string representations (ex: "wP"). */
extern const char *piece_lookup[TOTAL_TYPES];


/* Struct to store Chezz board game header metadata. */
typedef struct {
    char turn;       // 'w' or 'b' - Player's turn
    int time_taken;  // time taken for the move
    int max_time;    // max time allowed per move
    int num_moves;   // num moves made
} Header;


/* Struct to track piece positions and game state on the Chezz board. */
typedef struct {
    Header header;                // game metadata
    Bitboard pieces[TOTAL_TYPES]; // 18 bitboards (one for each piece type and color)
    Bitboard white_pieces;        // combined bitboard for all white pieces
    Bitboard black_pieces;        // combined bitboard for all black pieces
    Bitboard all_pieces;          // bitboard representing all occupied squares
    int score;                    // score for this move
} Chezzboard;


/*
 * Sets the bit for the given square in the Bitboard.
 * square: Square index (0-63) to set.
 * board: Ptr to the Bitboard to modify.
 * Returns nothing.
 */
static inline void setPiece(Square square, Bitboard *board) {
    *board |= (1ULL << square);
}


/* Macro to return the max of two values. */
#define MAX(a,b) ((a) > (b) ? (a) : (b))

/* Macro to return the min of two values. */
#define MIN(a,b) ((a) < (b) ? (a) : (b))


/* Function declarations for main.c. */
int get_piece_index(const char *piece);                             // converts piece string to PieceType index
int square_to_index(const char *square);                            // converts square notation to bitboard index
void load_board_from_file(Chezzboard *board, const char *filename); // loads board from file
void load_board_from_stdin(Chezzboard *board);                      // loads board from stdin
void load_board_from_string(Chezzboard *board, const char *input);  // loads board from in-memory string
char *to_string(Chezzboard *board);                                 // converts board to string representation

/*
 * Function-call API: compute best move from a string, write result to output buffer.
 * input: Null-terminated board string in the standard wire format.
 * output: Caller-provided buffer for the result string.
 * output_size: Size of the output buffer in bytes (>= 2048 recommended).
 * Returns 0 on success; -1 if output buffer is too small.
 *
 * Thread-safe (internal mutex); does not use stdin or stdout.
 * Use this instead of the standalone binary for in-process parallel games.
 */
CHEZZ_API int engine_best_move(const char *input, char *output, size_t output_size);



#endif // CHEZZ_H
