/* Header file for Chezz game material evaluation, defining constants and functions. */

#ifndef MATERIAL_EVAL_H
#define MATERIAL_EVAL_H

#include "chezz.h"

/* Struct to hold material values for a piece type across game phases. */
typedef struct {
    int startgame;  // start game value
    int midgame;    // mid game value
    int endgame;    // end game value
} MaterialValues;

/* Table holding material values for each piece type, indexed by PieceType enum. */
extern const MaterialValues material_table[TOTAL_TYPES];


/* Function declarations for material_eval.c. */
int material_score(const Chezzboard *board, int color);

#endif // MATERIAL_EVAL_H