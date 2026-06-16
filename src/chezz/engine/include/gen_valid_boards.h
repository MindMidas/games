/* Header file for generating and managing valid Chezz moves/boards. */

#ifndef GEN_VALID_BOARDS_H
#define GEN_VALID_BOARDS_H

#include "chezz.h"
#include "nsp.h"
#include "sp.h"


/* Dynamic array struct to store valid Chezz boards. */
typedef struct {
    Chezzboard *boards;  // array to hold valid chezz boards
    size_t count;        // num chezz boards in boards
    size_t capacity;     // current capacity for resizing
    int next_index;      // for move ordering
} ValidBoards;


/* Function declarations for gen_valid_boards.c. */
ValidBoards gen_chezz_boards(Chezzboard *board, int color);            // gen all valid moves from the curr board config
void init_chezz_boards(ValidBoards *chezz_boards);                     // init the valid boards array
void add_board(ValidBoards *chezz_boards, Chezzboard *new_board, 
                bool evaluate, int color);                             // add a new board to the array
void free_chezz_boards(ValidBoards *chezz_boards);                     // free the valid boards array
void move_piece(Chezzboard *board, int piece_type, int from, int to);  // move a piece on the board
void capture_piece(Chezzboard *board, int target);                     // capture a piece at the target square

void set_peon_moves(Chezzboard *board, 
                    int square,
                    int piece_type,
                    Bitboard pseudo_legal_moves, 
                    Bitboard enemy, 
                    ValidBoards *chezz_boards,
                    int color);                 // set valid moves for a peon

void set_piece_moves(Chezzboard *board, 
                     int square, 
                     int piece_type,
                     Bitboard pseudo_legal_moves,
                     Bitboard enemy, 
                     ValidBoards *chezz_boards,
                     int color);                // set valid moves for standard pieces

void set_catapult_flings(Chezzboard *board, 
                         int square, 
                         int piece_type,
                         Bitboard friendly,
                         Bitboard enemy, 
                         ValidBoards *chezz_boards,
                         bool eval,
                         int color);             // set valid catapult fling moves

void set_canon_shots(Chezzboard *board, 
                     int square, 
                     Bitboard friendly,
                     Bitboard enemy, 
                     ValidBoards *chezz_boards,
                     int color);                 // set valid canon shot moves

void promote_peons(Chezzboard *board);                         // promote peons to zombies
void handle_contagion(Chezzboard *board);                      // handle contagion
int equal(const Chezzboard *board1, const Chezzboard *board2); // cmp two boards for equality


#endif // GEN_VALID_BOARDS_H