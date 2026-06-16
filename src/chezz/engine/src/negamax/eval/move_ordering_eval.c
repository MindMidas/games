#include "king_safety_eval.h"
#include "piece_safety_eval.h"
#include "material_eval.h"
#include "mobility_eval.h"
#include "peon_struct_eval.h"
#include "pos_eval.h"


/*
 * Evaluates a move/board for move ordering sort.
 * board: Ptr to the Chezzboard to evaluate.
 * color: 1 for white, -1 for black.
 * Returns int score (positive favours curr player, negative favours opponent)
 */
int move_ordering_eval(Chezzboard *move, int color) {

  // check if king is alive for opponent player
  if (!is_king_alive(move, -color)) return INFINITY + 1;

  // check if king is alive for curr player
  else if (!is_king_alive(move, color)) return -INFINITY - 1;

  // check if king is in check for curr player
  else if (is_king_in_check(move, color)) return -INFINITY;

  // check if king is in check for opponent player
  else if (is_king_in_check(move, -color)) return INFINITY;

  // otherwise return static eval for move
  return (material_score(move, color) 
            + king_safety_score(move, color) 
              + pos_score(move, color) 
                + peon_structure_score(move, color)
                  + piece_safety_score(move, color));
}