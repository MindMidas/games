#include "negamax.h"
#include "eval.h"
#include "king_safety_eval.h"


/*
 * Function to perform negamax search with alpha-beta pruning and transposition table.
 * new_game: True if new game, false if continuing a previous game.
 * move: Ptr to the Chezzboard config for curr move to evaluate.
 * depth: Curr depth in search tree.
 * max_depth: Max depth to search.
 * alpha: Best score maximizing player can guarantee (lower bound).
 * beta: Best score minimizing player can guarantee (upper bound).
 * color: 1 for White (maximizing), -1 for Black (minimizing).
 * Returns negamax score for current move.
 */
int negamax(Chezzboard *move, 
            int depth,
            int max_depth, 
            int alpha, 
            int beta,
            int color) {
    
    // define variables for negamax
    int best_score = -INFINITY;
    int num_moves = 0;       
    ValidBoards valid_moves;
    TTEntry* tt_entry;
    int original_alpha = alpha;
    Bitboard hash = hash_board(move);
    
    /*
 * 1. Probe Transposition Table
 * - Check TT for cached score to prune early
 * - Adjust alpha/beta and return if cutoff occurs
 */
    tt_entry = tt_probe(hash, move);

    if (tt_entry != NULL && tt_entry->depth >= depth) {

        // check reliability of score
        switch (tt_entry->flag) {

            // exact eval -> curr move from prev search at least as deep as the current depth
            case TT_EXACT: return tt_entry->score; break;
        
            // lower bound eval -> true score >= value
            case TT_LOWER: alpha = MAX(alpha, tt_entry->score); break;
            
            // upper bound eval -> true score <= value
            case TT_UPPER: beta = MIN(beta, tt_entry->score); break;
        }

        // alpha-beta pruning
        if (alpha >= beta) return tt_entry->score;
        
    }


    /*
 * 3. Base Case: Max Depth
 * - Return static evaluation if depth limit reached
 */
    if (depth >= max_depth) {
        return evaluate(move, color);
    }


    /*
 * 4. Endgame Case: King Capture
 * Special case: King in Check
 */
    
    // if (!is_king_alive(move, color) || !is_king_alive(move, -color)) return evaluate(move, color);
    // else if (is_king_in_check(move, color) || is_king_in_check(move, -color)) return evaluate(move, color);

    if (!is_king_alive(move, color)) return -INFINITY;
    else if (!is_king_alive(move, -color)) return INFINITY;


    /* 5. Generate next moves */
    valid_moves = gen_chezz_boards(move, color);
    num_moves = valid_moves.count;


    /*
 * 6. Move Exploration Loop
 * - Recursively search next moves with alpha-beta pruning
 */
    Chezzboard next_move;

    // iterate over each next move for the current move
    for (int i = 0; i < num_moves; i++) {

        // get next move
        next_move = select_best_move(&valid_moves);

        // recursively search the next move
        best_score = MAX(best_score, -negamax(&next_move, depth + 1, max_depth, -beta, -alpha, -color));
        
        // update: best guaranteed score for maximizing player
        if (best_score > alpha) {
            alpha = best_score;
        }

        // beta cutoff, prune branch
        if (alpha >= beta) {
            break;
        }
    }

    
    /*
 * 7. Cleanup and TT Storage
 * - Store score in TT for other threads and curr
 */
    
    free_chezz_boards(&valid_moves);

    // setflag
    TTFlag flag;
    if (best_score <= original_alpha)
        flag = TT_UPPER;
    else if (best_score >= beta)
        flag = TT_LOWER;
    else
        flag = TT_EXACT;
    
    tt_store(hash, best_score, depth, flag, move);

    return best_score;
}



/*
 * Selects the best move based on score and updates next_index.
 * valid_moves: Ptr to ValidBoards struct containing all valid moves.
 * Returns chezzboard of best move.
 */
Chezzboard select_best_move(ValidBoards *valid_moves) {

    // start search from next_index
    int best_index = valid_moves->next_index;
    int best_score = valid_moves->boards[best_index].score;

    // find move with the highest score
    for (size_t i = valid_moves->next_index; i < valid_moves->count; i++) { 

        if (valid_moves->boards[i].score > best_score) {
            best_score = valid_moves->boards[i].score;
            best_index = i;
        }
    }

    // swap only if a better move was found
    if (best_index != valid_moves->next_index) {
        Chezzboard temp = valid_moves->boards[valid_moves->next_index];
        valid_moves->boards[valid_moves->next_index] = valid_moves->boards[best_index];
        valid_moves->boards[best_index] = temp;
    }

    // Get the best move (now at next_index)
    Chezzboard best_move = valid_moves->boards[valid_moves->next_index];

    // move next_index forward
    valid_moves->next_index++;

    return best_move;
}