/* Header file for the negamax search algorithm in the Chezz game engine. */

#ifndef NEGAMAX_H
#define NEGAMAX_H

#include "chezz.h"
#include "tt.h"
#include "gen_valid_boards.h"

/* Function declarations for negamax.c. */
int negamax(Chezzboard *move, 
            int depth,
            int max_depth,
            int alpha, 
            int beta,
            int color);  // perform negamax search with alpha-beta pruning and TT

Chezzboard select_best_move(ValidBoards *valid_moves); // selects best move

#endif // NEGAMAX_H
