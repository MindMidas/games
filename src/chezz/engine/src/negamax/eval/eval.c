#include "king_safety_eval.h"
#include "piece_safety_eval.h"
#include "material_eval.h"
#include "mobility_eval.h"
#include "peon_struct_eval.h"
#include "pos_eval.h"


/*
 * Evaluates the given move with multiple heuristics.
 * move: Ptr to the Chezzboard move/board.
 * color: Int color of curr player (1 for white, -1 for black).
 * Returns int score (positive favors current player, negative favors opponent).
 */
int evaluate(Chezzboard *move, int color) {

  return (mobility_score(move, color)
            + material_score(move, color)
              + king_safety_score(move, color)
                + piece_safety_score(move, color)
                  + peon_structure_score(move, color)
                    + pos_score(move, color));
}
