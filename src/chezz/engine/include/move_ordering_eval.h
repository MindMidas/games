/*
 * Header file for eval function for move ordering. Defines constants & function prototypes for fast move ordering.
 */

#ifndef MOVE_ORDERING_EVAL_H
#define MOVE_ORDERING_EVAL_H

#include "chezz.h" 

/* Function declarations for move_ordering_eval.c. */

int move_ordering_eval(Chezzboard *move, int color); // evaluates a move for fast ordering


#endif // MOVE_ORDERING_EVAL_H