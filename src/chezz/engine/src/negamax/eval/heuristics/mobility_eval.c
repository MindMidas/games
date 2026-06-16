#include "mobility_eval.h"
#include "nsp.h"
#include "sp.h"

const int immobility_penalty[TOTAL_TYPES] = {
    -2,  -2,   // wP, bP
    -3,  -3,   // wN, bN 
   -10, -10,   // wB, bB
   -10, -10,   // wR, bR
   -20, -20,   // wQ, bQ
   -50, -50,   // wK, bK  (only if trapped)
    -1,  -1,   // wZ, bZ
    -5,  -5,   // wF, bF
   -20,  -20   // wC, bC
};

const int mobility_reward[TOTAL_TYPES] = {
    3,  3,   // wP, bP 
    6,  6,   // wN, bN 
    9,  9,   // wB, bB 
   12, 12,   // wR, bR 
   16, 16,   // wQ, bQ 
    0,  0,   // wK, bK 
    6,  6,   // wZ, bZ 
    6,  6,   // wF, bF 
    8,  8    // wC, bC 
};

/*
 * Evaluates the mobility of each piece for both sides for a given move.
 * board: Ptr to the Chezzboard move/board.
 * color: 1 for white, -1 for black.
 * Returns int score (positive favors White, negative favors Black).
 */
int mobility_score(const Chezzboard *board, int color) {

    /* 1. Initialization */
    Bitboard white_pieces = board->white_pieces;
    Bitboard black_pieces = board->black_pieces;
    Bitboard all_pieces = board->all_pieces;
    Bitboard white_attack_mask = 0;
    Bitboard black_attack_mask = 0;
    Bitboard wk_mask = board->pieces[WK];
    Bitboard bk_mask = board->pieces[BK];
    Bitboard wc_attack_mask = 0;
    Bitboard bc_attack_mask = 0;
    Bitboard wf_mask = 0;
    Bitboard bf_mask = 0;
    Bitboard wq_mask = 0;
    Bitboard bq_mask = 0;
    Bitboard wr_mask = 0;
    Bitboard br_mask = 0;
    Bitboard wb_mask = 0;
    Bitboard bb_mask = 0;
    Bitboard wn1_mask = 0;
    Bitboard wn2_mask = 0;
    Bitboard bn1_mask = 0;
    Bitboard bn2_mask = 0;

    int white_score = 0;
    int black_score = 0;

    int white_attack_count[TOTAL_SQUARES] = {0};
    int black_attack_count[TOTAL_SQUARES] = {0};
    
    LegalMoves white_legal_moves[32];
    LegalMoves black_legal_moves[32];

    int white_counter = 0;
    int black_counter = 0;
    
    /* 1. Generate full attack mask for black & white pieces */
    for (int piece = WP; piece <= BC; piece++) {
        
        Bitboard pieces = board->pieces[piece];

        while (pieces) {

            // get piece square
            int square = __builtin_ctzll(pieces);
            pieces &= pieces - 1;

            Bitboard mobility_attack_mask = 0;

            // sliding pieces and (canon + catapult)
            switch (piece) {
                case WR: case BR: mobility_attack_mask = rook_attacks(square, all_pieces); break;
                case WB: case BB: mobility_attack_mask = bishop_attacks(square, all_pieces); break;
                case WQ: case BQ: mobility_attack_mask = queen_attacks(square, all_pieces); break;
                case WC: case BC: mobility_attack_mask = bishop_attacks(square, 0ULL); break;
                case WF: case BF: {
                    // get adjacent friendly pieces
                    Bitboard adjacent_mask = nsp_table[piece][square];
                    Bitboard friendly_mask = ((piece & 1) == 0) ? white_pieces : black_pieces;
                    Bitboard enemy_king = ((piece & 1) == 0) ? board->pieces[BK] : board->pieces[WK];

                    // keep only friendly pieces that can be flung
                    Bitboard flingable_pieces = adjacent_mask & friendly_mask;

                    // catapult attack mask is bishop and rook attack mask
                    Bitboard flinger_attack_mask = 0;
                    
                    // iterate over flingable pieces
                    while (flingable_pieces) {

                        // get LSB
                        int adj_square = __builtin_ctzll(flingable_pieces);
                        flingable_pieces &= flingable_pieces - 1;

                        // compute row & column of current and adjacent pieces
                        int piece_row = square / 8, piece_col = square % 8;
                        int adj_row = adj_square / 8, adj_col = adj_square % 8;

                        // calculate the opposite square
                        int opposite_row = piece_row + (piece_row - adj_row);
                        int opposite_col = piece_col + (piece_col - adj_col);

                        // gen full adjacent blocking mask (all 8 directions)
                        Bitboard adjacent_blockers = nsp_table[piece][square];

                        // remove square opposite to adj piece
                        if (opposite_row >= 0 && opposite_row < 8 && opposite_col >= 0 && opposite_col < 8) {
                            int opposite_square = opposite_row * 8 + opposite_col;
                            adjacent_blockers &= ~(1ULL << opposite_square);
                        }
                        
                        // compute attack mask 
                        if (abs(piece_row - adj_row) == 1 && abs(piece_col - adj_col) == 1) {
                            Bitboard temp_attack_mask = bishop_attacks(square, adjacent_blockers);
                            temp_attack_mask &= ~adjacent_blockers;
                            flinger_attack_mask |= temp_attack_mask;
                        } else {
                            Bitboard temp_attack_mask = rook_attacks(square, adjacent_blockers);
                            temp_attack_mask &= ~adjacent_blockers;
                            flinger_attack_mask |= temp_attack_mask;
                        }
                        
                        // remove flings landing on enemy king or friendly pieces
                        flinger_attack_mask &= ~enemy_king;
                    }

                    mobility_attack_mask = flinger_attack_mask;
                    
                    break;
                }
                default: {

                    mobility_attack_mask = nsp_table[piece][square];
                    
                    // peons only capture diagonally, remove forward moves
                    if (piece == WP) {
                        mobility_attack_mask = mobility_attack_mask & ~(1ULL << (square + 8));
                    } else if (piece == BP) {
                        mobility_attack_mask = mobility_attack_mask & ~(1ULL << (square - 8));
                    }

                    break;
                }
            }


            Bitboard mobility_attack_mask_copy = mobility_attack_mask;

            // add bits to the attack count array
            while (mobility_attack_mask_copy) {

                int attack_square = __builtin_ctzll(mobility_attack_mask_copy);
                mobility_attack_mask_copy &= (mobility_attack_mask_copy - 1);

                int is_white = ((piece & 1) == 0);

                white_attack_count[attack_square] += is_white;
                black_attack_count[attack_square] += !is_white;
            }

            
            // for white add legal moves and attack mask
            if ((piece & 1) == 0) { 

                white_attack_mask |= mobility_attack_mask;
                white_legal_moves[white_counter].piece_type = piece;
                white_legal_moves[white_counter].square = square;

                // process WQ WR WB WN WZ
                if (piece != WC && piece != WF && piece != WP) {

                    white_legal_moves[white_counter].legal_moves = mobility_attack_mask & ~white_pieces;

                    if (piece == WQ) wq_mask = mobility_attack_mask & ~white_pieces;
                    if (piece == WR) wr_mask = mobility_attack_mask & ~white_pieces;
                    if (piece == WB) wb_mask = mobility_attack_mask & ~white_pieces;
                    if (piece == WN) {
                        if (wn1_mask == 0) wn1_mask = mobility_attack_mask;
                        else wn2_mask = mobility_attack_mask;
                    }
                
                // process WC WF WP
                } else {
                    
                    if (piece != WP) {

                        white_legal_moves[white_counter].legal_moves = nsp_table[piece][square] & ~all_pieces;

                        if (piece == WC) wc_attack_mask = mobility_attack_mask;
                        if (piece == WF) wf_mask = nsp_table[piece][square];
                        
                    } else {          
                        // get forward move for white peon
                        int forward_sq = square + 8; 

                        // keep existing attacks and add forward move if it's not blocked
                        white_legal_moves[white_counter].legal_moves = (mobility_attack_mask & black_pieces) & ~white_pieces;

                        if (forward_sq <= 63 && !((1ULL << forward_sq) & all_pieces)) {
                            white_legal_moves[white_counter].legal_moves |= (1ULL << forward_sq);
                        }
                    }
                }

                white_counter++;
            }
            
            // for black add legal moves and attack mask
            else {
                black_attack_mask |= mobility_attack_mask;
                black_legal_moves[black_counter].piece_type = piece;
                black_legal_moves[black_counter].square = square;

                // process BQ BR BB BN
                if (piece != BC && piece != BF && piece != BP) {

                    black_legal_moves[black_counter].legal_moves = mobility_attack_mask & ~black_pieces;

                    if (piece == BQ) bq_mask = mobility_attack_mask & ~black_pieces;
                    if (piece == BR) br_mask = mobility_attack_mask & ~black_pieces;
                    if (piece == BB) bb_mask = mobility_attack_mask & ~black_pieces;
                    if (piece == BN) {
                        if (bn1_mask == 0) bn1_mask = mobility_attack_mask;
                        else bn2_mask = mobility_attack_mask;
                    }
                } 
                
                // process BC BF BP
                else {
                    
                    if (piece != BP) {
                        black_legal_moves[black_counter].legal_moves = nsp_table[piece][square] & ~all_pieces;
                        if (piece == BC) bc_attack_mask = mobility_attack_mask;
                        if (piece == BF) bf_mask = nsp_table[piece][square];

                    } else {
                        // get forward move for black peon
                        int forward_sq = square - 8; 

                        // keep existing attacks and add forward move if it's not blocked
                        black_legal_moves[black_counter].legal_moves = (mobility_attack_mask & white_pieces) & ~black_pieces;
                        if (forward_sq >= 0 && !((1ULL << forward_sq) & all_pieces)) {
                            black_legal_moves[black_counter].legal_moves |= (1ULL << forward_sq);
                        }
                    }
                    
                }
                black_counter++;
            }
        }
    }


    
    /*
 * 2. Calculate rewards and penalties for white score
 * - for safe & unsafe squares
 * - for coordination between pieces
 */
    // iterate over each white
    for (int i = 0; i < white_counter; i++) {

        // get legal moves for piece
        Bitboard pieces_legal_moves = white_legal_moves[i].legal_moves;
        int piece_type = white_legal_moves[i].piece_type;

        // total moves
        int total_moves = __builtin_popcountll(pieces_legal_moves);

        // compute safe moves (legal moves that are NOT attacked by black)
        Bitboard safe_moves = pieces_legal_moves & ~black_attack_mask;
        int total_safe_moves = __builtin_popcountll(safe_moves);

        // compute unsafe moves (legal moves that ARE attacked by black)
        int total_unsafe_moves = total_moves - total_safe_moves;

        // (1) Reward: safe squares give a bonus
        white_score += total_safe_moves * mobility_reward[piece_type];

        // (2) Penalty: If a piece cannot safely move
        if (total_unsafe_moves > 0) {
            
            // white king gets a one-time penalty for immobility
            if (total_safe_moves == 0 && piece_type == WK) {
                white_score += immobility_penalty[piece_type];
            }
            // other pieces get multiplier
            else if (piece_type != WK) {
                white_score += total_unsafe_moves * immobility_penalty[piece_type];
            }
        }
    }

    
    /*
 * 3. Calculate rewards and penalties for white score
 * - for piece coordination
 */
    // (1) Penalty: for friendly pieces in canon shot path (if there are black_pieces in the path)
    if (__builtin_popcountll(wc_attack_mask & black_pieces) > 0) {
        int white_friendly_in_canon_path = __builtin_popcountll(wc_attack_mask & white_pieces);
        white_score += white_friendly_in_canon_path * BLOCKING_CANON_SHOT;
    }


    // (2) Reward: pieces that position themselves behind the catapult (ignore king)
    if (wf_mask) {
        int wf_square = __builtin_ctzll(board->pieces[WF]);

        // compute friendly pieces behind the catapult (3 squares behind)
        Bitboard white_support_mask = (wf_square >= 16) ? ((1ULL << (wf_square - 8)) | (1ULL << (wf_square - 7)) | (1ULL << (wf_square - 9))) : 0;
        int white_pieces_supporting = __builtin_popcountll(white_support_mask & white_pieces & ~wk_mask);

        white_score += white_pieces_supporting * BEHIND_FRIENDLY_CATAPULT;
    }   


    // (3) Reward: queen and rook watching same col/row
    if (wq_mask && wr_mask) {

        //check if queen & rook control the same col/row
        Bitboard shared_path = wq_mask & wr_mask;

        // if no friendly pieces block their direct connection
        if (!(shared_path & all_pieces)) {
            white_score += QUEEN_ROOK_COORDINATION * 2;
        } else if (shared_path & black_pieces) {
            white_score += QUEEN_ROOK_COORDINATION;
        }
    }

    // (4) Reward: queen and bishop watching same diagonal
    if (wq_mask && wb_mask) {

        // check if queen & bishop control the same diagonal
        Bitboard shared_diagonal = wq_mask & wb_mask;

        // if no friendly pieces block their direct connection
        if (!(shared_diagonal & white_pieces)) {
            white_score += QUEEN_BISHOP_COORDINATION;
        }
    }

    // (5) Reward: knights for watching same squares
    if (wn1_mask && wn2_mask) {
        // get squares attacked by both knights
        Bitboard shared_knight_attacks = wn1_mask & wn2_mask;

        // if they attack the same square, reward
        if (shared_knight_attacks) {
            white_score += KNIGHT_ATTACK_COORDINATION;
        }
    }
    
    // (6) Reward: knights for protecting each other
    if (wn1_mask && wn2_mask) {

        // get knight1
        Bitboard wn1_pos = __builtin_ctzll(board->pieces[WN] & white_pieces);

        // convert to bitboard
        Bitboard wn1_bitboard = (1ULL << wn1_pos);

        if (wn1_bitboard & wn2_mask) {
            white_score += KNIGHT_DEFEND_COORDINATION;
        }
    }
    

    /*
 * 6. Calculate rewards and penalties for black score
 * - for safe & unsafe squares
 */
    // iterate over each black
    for (int i = 0; i < black_counter; i++) {

        // get legal moves for piece
        Bitboard pieces_legal_moves = black_legal_moves[i].legal_moves;
        int piece_type = black_legal_moves[i].piece_type;

        // total moves
        int total_moves = __builtin_popcountll(pieces_legal_moves);

        // compute safe moves (legal moves that are NOT attacked by white)
        Bitboard safe_moves = pieces_legal_moves & ~white_attack_mask;
        int total_safe_moves = __builtin_popcountll(safe_moves);

        // compute unsafe moves (legal moves that ARE attacked by white)
        int total_unsafe_moves = total_moves - total_safe_moves;

        // (1) Reward: safe squares give a bonus
        black_score += total_safe_moves * mobility_reward[piece_type];

        // (2) Penalty: If a piece cannot safely move
        if (total_unsafe_moves > 0) {
            
            // black king gets a one-time penalty for immobility
            if (total_safe_moves == 0 && piece_type == BK) {
                black_score += immobility_penalty[piece_type];
            }
            // other pieces get multiplier
            else if (piece_type != BK) {
                black_score += total_unsafe_moves * immobility_penalty[piece_type];
            }
        }
    }

    /*
 * 7. Calculate rewards and penalties for white score
 * - for piece coordination
 */
    // (1) Penalty: for friendly pieces in canon shot path (if there are black_pieces in the path)
    if (__builtin_popcountll(bc_attack_mask & white_pieces) > 0) {
        int black_friendly_in_canon_path = __builtin_popcountll(bc_attack_mask & black_pieces);
        black_score += black_friendly_in_canon_path * BLOCKING_CANON_SHOT;
    }

    // (2) Reward: pieces that position themselves behind the catapult (ignore king)
    if (bf_mask) {
        int bf_square = __builtin_ctzll(board->pieces[BF]);

        // compute friendly pieces behind the catapult (3 squares behind)
        Bitboard black_support_mask = (bf_square <= 47) ? ((1ULL << (bf_square + 8)) | (1ULL << (bf_square + 7)) | (1ULL << (bf_square + 9))) : 0;
        int black_pieces_supporting = __builtin_popcountll(black_support_mask & black_pieces & ~bk_mask);

        black_score += black_pieces_supporting * BEHIND_FRIENDLY_CATAPULT;
    }

    // (3) Reward: queen and rook watching same col/row
    if (bq_mask && br_mask) {

        // check if queen & rook control the same col/row
        Bitboard shared_path = bq_mask & br_mask;

        // if no friendly pieces block their connection
        if (!(shared_path & all_pieces)) {
            black_score += QUEEN_ROOK_COORDINATION * 2;
        } else if (shared_path & black_pieces) {
            black_score += QUEEN_ROOK_COORDINATION;
        }
    }

    // (4) Reward: queen and bishop watching same diagonal
    if (bq_mask && bb_mask) {

        // check if queen & bishop control same diagonal
        Bitboard shared_diagonal = bq_mask & bb_mask;

        // if no friendly pieces their direct connection
        if (!(shared_diagonal & black_pieces)) {
            black_score += QUEEN_BISHOP_COORDINATION;
        }
    }
    
    // (5) Reward: knights for watching same squares
    if (bn1_mask && bn2_mask) {

        // get squares attacked by both knights
        Bitboard shared_knight_attacks = bn1_mask & bn2_mask;

        // if they attack the same square, reward
        if (shared_knight_attacks) {
            black_score += KNIGHT_ATTACK_COORDINATION;
        }
    }
    
    // (6) Reward: knights for protecting each other
    if (bn1_mask && bn2_mask) {

        // get knight1
        Bitboard bn1_pos = __builtin_ctzll(board->pieces[BN] & black_pieces);

        // convert to bitboard
        Bitboard bn1_bitboard = (1ULL << bn1_pos);

        if (bn1_bitboard & bn2_mask) {
            black_score += KNIGHT_DEFEND_COORDINATION;
        }
    }


    /*
 * 8. Calculate rewards and penalties for white & black score
 * - Reward: for more squares under "control"
 * - Penalty: for less squares under "control"
 */
    for (int i = 0; i < TOTAL_SQUARES; i++) {

        int control_difference = white_attack_count[i] - black_attack_count[i];
        
        white_score += control_difference * CONTROLLING_SQUARES;
        black_score -= control_difference * CONTROLLING_SQUARES;
    }

    /*
 * 9. Calculate rewards and penalties for white & black score
 * - Reward: attacking the king (lining up) with multiplier
 */

    int control_difference;

    // for white 
    if (bk_mask) {
        int bk_square = __builtin_ctzll(bk_mask);
        control_difference = white_attack_count[bk_square] - black_attack_count[bk_square]; 
        if (control_difference > 0) {
            white_score += control_difference * KING_ATTACK_COORDINATION;
        }
    }   

    // for black 
    if (wk_mask) {
        int wk_square = __builtin_ctzll(wk_mask);
        control_difference = black_attack_count[wk_square] - white_attack_count[wk_square];
        if (control_difference > 0) {
            black_score += control_difference * KING_ATTACK_COORDINATION;
        }
    }

    return (white_score - black_score) * color;
}