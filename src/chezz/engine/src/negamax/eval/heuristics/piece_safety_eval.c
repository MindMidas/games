#include "piece_safety_eval.h"
#include "nsp.h"
#include "sp.h"
#include "gen_valid_boards.h"
#include "material_eval.h"

/*
 * Evaluates piece safety for all pieces on the board.
 * board: Ptr to the Chezzboard move.
 * color: 1 for white, -1 for black.
 * Returns int score (positive favors the current player's turn).
 * Note: incomplete
 */
int piece_safety_score(const Chezzboard *board, int color) {
    
    /* 1. Initialization */
    int white_score = 0;
    int black_score = 0;

    // get all pieces for attack and defense calcs
    Bitboard white_pieces = board->white_pieces;
    Bitboard black_pieces = board->black_pieces;
    Bitboard all_pieces = board->all_pieces;

    AttackMask white_attack_masks[32];
    AttackMask black_attack_masks[32];

    int white_counter = 0;
    int black_counter = 0;
    
    Bitboard white_cannon_mask = 0;
    Bitboard black_cannon_mask = 0;

    Bitboard white_canon_moves = 0;
    Bitboard black_canon_moves = 0;

    Bitboard white_king_moves = 0;
    Bitboard black_king_moves = 0;

    int white_canon_landing_cost[TOTAL_SQUARES] = {0};
    int black_canon_landing_cost[TOTAL_SQUARES] = {0};


    /* 2. Generate attack masks for all pieces */
    for (int piece = WP; piece <= BC; piece++) {

        // Get the bitboard for this piece type
        Bitboard pieces = board->pieces[piece];

        while (pieces) {

            // get piece square
            int square = __builtin_ctzll(pieces);
            pieces &= pieces - 1;

            switch (piece) {
                
                case WP: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = nsp_table[piece][square] & ~(1ULL << (square + 8));
                    white_counter++;
                    break;

                case BP:
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = nsp_table[piece][square] & ~(1ULL << (square - 8));
                    black_counter++;
                    break;

                case WR: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = rook_attacks(square, all_pieces);
                    white_counter++;
                    break;

                case BR: 
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = rook_attacks(square, all_pieces); 
                    black_counter++;
                    break;

                case WB: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = bishop_attacks(square, all_pieces);
                    white_counter++;
                    break;

                case BB: 
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = bishop_attacks(square, all_pieces); 
                    black_counter++;
                    break;

                case WQ: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = queen_attacks(square, all_pieces);
                    white_counter++;
                    break;

                case BQ: 
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = queen_attacks(square, all_pieces); 
                    black_counter++;
                    break;

                case WC: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = bishop_attacks(square, 0ULL);
                    white_cannon_mask = white_attack_masks[white_counter].attack_mask;
                    white_canon_moves = nsp_table[WC][square] & ~all_pieces;
                    white_counter++;
                    break;

                case BC: 
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = bishop_attacks(square, 0ULL); 
                    black_cannon_mask = black_attack_masks[black_counter].attack_mask;
                    black_canon_moves = nsp_table[BC][square] & ~all_pieces;
                    black_counter++;
                    break;
                
                case WF: case BF:  {

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
                            // remove flings landing on enemy king or friendly pieces
                            temp_attack_mask &= ~enemy_king;

                            // add the piece material cost to map
                            int flung_type = -1;
                            if (temp_attack_mask) {

                                // get white flung type
                                if ((piece & 1) == 0) {
                                    for (int pt = WP; pt < TOTAL_TYPES; pt += 2) {
                                        if (board->pieces[pt] & (1ULL << adj_square)) {
                                            flung_type = pt;
                                            break;
                                        }
                                    }
                                } 
                                
                                // get black flung type
                                else {
                                    for (int pt = BP; pt < TOTAL_TYPES; pt += 2) {
                                        if (board->pieces[pt] & (1ULL << adj_square)) {
                                            flung_type = pt;
                                            break;
                                        }
                                    }
                                }

                                if (flung_type != -1) {
                                    int material_val = material_table[flung_type].midgame;

                                    if (flung_type == WK || flung_type == BK) {
                                        material_val = 3600;
                                    }

                                    Bitboard landing_sqrs = temp_attack_mask;

                                    while (landing_sqrs) {
                                        int landing_sq = __builtin_ctzll(landing_sqrs);
                                        landing_sqrs &= landing_sqrs - 1;
                                        if ((piece & 1) == 0) {
                                            white_canon_landing_cost[landing_sq] += material_val;
                                        } else {
                                            black_canon_landing_cost[landing_sq] += material_val;
                                        }
                                    }
                                }

                            }

                            flinger_attack_mask |= temp_attack_mask;

                        } else {
                            Bitboard temp_attack_mask = rook_attacks(square, adjacent_blockers);
                            temp_attack_mask &= ~adjacent_blockers;
                            // remove flings landing on enemy king or friendly pieces
                            temp_attack_mask &= ~enemy_king;

                            // add the piece material cost to map
                            int flung_type = -1;
                            if (temp_attack_mask) {

                                // get white flung type
                                if ((piece & 1) == 0) {
                                    for (int pt = WP; pt < TOTAL_TYPES; pt += 2) {
                                        if (board->pieces[pt] & (1ULL << adj_square)) {
                                            flung_type = pt;
                                            break;
                                        }
                                    }
                                } 
                                
                                // get black flung type
                                else {
                                    for (int pt = BP; pt < TOTAL_TYPES; pt += 2) {
                                        if (board->pieces[pt] & (1ULL << adj_square)) {
                                            flung_type = pt;
                                            break;
                                        }
                                    }
                                }

                                if (flung_type != -1) {
                                    int material_val = material_table[flung_type].midgame;

                                    if (flung_type == WK || flung_type == BK) {
                                        material_val = 3600;
                                    }
                                    
                                    Bitboard landing_sqrs = temp_attack_mask;

                                    while (landing_sqrs) {
                                        int landing_sq = __builtin_ctzll(landing_sqrs);
                                        landing_sqrs &= landing_sqrs - 1;
                                        if ((piece & 1) == 0) {
                                            white_canon_landing_cost[landing_sq] += material_val;
                                        } else {
                                            black_canon_landing_cost[landing_sq] += material_val;
                                        }
                                    }
                                }
                            }

                            flinger_attack_mask |= temp_attack_mask;
                        }
                    }

                    if ((piece & 1) == 0) {
                        white_attack_masks[white_counter].square = square;
                        white_attack_masks[white_counter].piece_type = piece;
                        white_attack_masks[white_counter].attack_mask = flinger_attack_mask;
                        white_counter++;
                    } else {
                        black_attack_masks[black_counter].square = square;
                        black_attack_masks[black_counter].piece_type = piece;
                        black_attack_masks[black_counter].attack_mask = flinger_attack_mask;
                        black_counter++;
                    }
                }
                    break;

                case WK : case WZ : case WN: 
                    white_attack_masks[white_counter].square = square;
                    white_attack_masks[white_counter].piece_type = piece;
                    white_attack_masks[white_counter].attack_mask = nsp_table[piece][square];
                    if (piece == WK) {
                        white_king_moves = white_attack_masks[white_counter].attack_mask & ~white_pieces;
                        white_attack_masks[white_counter].attack_mask = 0;
                    }
                    white_counter++;
                    break;
                    
                case BK : case BZ : case BN:
                    black_attack_masks[black_counter].square = square;
                    black_attack_masks[black_counter].piece_type = piece;
                    black_attack_masks[black_counter].attack_mask = nsp_table[piece][square];
                    if (piece == BK) {
                        black_king_moves = black_attack_masks[black_counter].attack_mask & ~black_pieces;
                        black_attack_masks[black_counter].attack_mask = 0;
                    }
                    black_counter++;
                    break;
            }
        }
    }

    int total_white = white_counter;
    int total_black = black_counter;

    /* 3. Evaluate white safety based on attacks & defenses */
    for (int i = 0; i < total_white; i++) {

        int square = white_attack_masks[i].square;
        int piece_type = white_attack_masks[i].piece_type;
        int piece_value = material_table[piece_type].midgame;

        Bitboard attackers = 0, defenders = 0;

        int total_attacker_value = 0;
        int total_defender_value = 0;

        int min_attacker_value = material_table[WQ].midgame;

        if (piece_type == WK) {
            piece_value = 3600;
        }

        // find black attackers
        for (int j = 0; j < total_black; j++) {

            // check if under attack
            if (black_attack_masks[j].attack_mask & (1ULL << square)) {

                // add enenmy piece to attackers
                attackers |= (1ULL << black_attack_masks[j].square);

                // get material value of attacker
                int attacker_value = material_table[black_attack_masks[j].piece_type].midgame;

                // use black canon landing map cost for value
                if (black_attack_masks[j].piece_type == BF) {
                    attacker_value = black_canon_landing_cost[square];
                }

                if (black_attack_masks[j].piece_type == BK) {
                    attacker_value = 3600;
                }
                
                // track min max attacker value
                if (attacker_value < min_attacker_value) {
                    min_attacker_value = attacker_value;
                }

                // sum total attacker material
                total_attacker_value += attacker_value;
            }
        }

        // find white defenders
        for (int j = 0; j < total_white; j++) {

            // check if defending
            if (white_attack_masks[j].attack_mask & (1ULL << square)) {

                // add friendly piece to defenders
                defenders |= (1ULL << white_attack_masks[j].square);

                // get material value of defender
                int defender_value = material_table[white_attack_masks[j].piece_type].midgame;

                if (white_attack_masks[j].piece_type == WF) {
                    defender_value = white_canon_landing_cost[square];
                }

                if (white_attack_masks[j].piece_type == WK) {
                    defender_value = 3600;
                }

                // sum total defender material
                total_defender_value += defender_value;
            }
        }


        /* 3. Calculate Safety Rewards and Penalties for White */
        // count total attackers
        int attacker_count = __builtin_popcountll(attackers);
        int defender_count = __builtin_popcountll(defenders);

        // (1) Penalty: if piece is under attack and not defended at all
        if (attacker_count > 0 && defender_count == 0) {
            white_score += EN_PRISE_PENALTY;
        }

        // (2) Penalty: if total attacker material is greater than total defender material
        if (attacker_count > defender_count) {
            white_score += (attacker_count - defender_count) * WEAK_DEFENSE_PENALTY;
        }

        // (3) Penalty: if the piece being attacked has a higher score than the weakest attacker
        if (piece_value > min_attacker_value) {
            white_score += LOW_VALUE_TRADE;
        }

        // (4) Reward: if piece is well defended and attackers are weaker
        if (defender_count > attacker_count) {
            white_score += (defender_count - attacker_count) * STRONG_DEFENSE_BONUS;
        }

        // (5) Reward: if piece is well defended with less material cost
        if (defender_count > attacker_count && total_defender_value < total_attacker_value) {
            white_score += DEFENSE_EFFICIENCY_BONUS;
        }

        // (6) Penalty: if piece under attack by canon
        if (black_cannon_mask & (1ULL << square)) {
            white_score += UNDER_ENEMY_CANON_ATTACK;
        }


        /* 3. Calculate Attack Rewards for White */

        // (1) Reward: encourage targeting enemy cannon movement mask
        if (white_attack_masks[i].attack_mask & black_canon_moves) {
            white_score += WATCHING_ENEMY_CANON;
        }

        // (2) Reward: encourage watching enemy king movement squares
        if (white_attack_masks[i].attack_mask & black_king_moves) {
            white_score += WATCHING_ENEMY_KING_MOVES;
        }

        // iterate over black pieces and compute scores
        Bitboard attack_mask = white_attack_masks[i].attack_mask;

        for (int j = 0; j < total_black; j++) {
            
            int enemy_square = black_attack_masks[j].square;
            int enemy_type = black_attack_masks[j].piece_type;
            int enemy_value = material_table[enemy_type].midgame;

            if (enemy_type == BK) {
                enemy_value = 3600;
            }

            if (attack_mask & (1ULL << enemy_square)) {
                
                // (3) Reward: encourage targeting enemy cannon 
                if (enemy_type == BC) {
                    white_score += ATTACKING_ENEMY_CANON;
                }

                // (4) Reward: attacking enemy king
                if (enemy_type == BK) {
                    white_score += CAPTURE_ENEMY_KING;
                }

                // count num defenders for enemy piece
                int enemy_defender_count = 0;
                for (int k = 0; k < total_black; k++) {
                    if (black_attack_masks[k].attack_mask & (1ULL << enemy_square)) {
                        enemy_defender_count++;
                    }
                }

                // (5) Reward: capturing enemy pieces that are undefended
                if (enemy_defender_count == 0) {
                    white_score += FREE_CAPTURE_BONUS;
                } 

                // (6) Reward: general capture incentive
                else {
                    white_score += CAPTURE_BASE_BONUS;
                }

                // (7) Reward: attacking high-value pieces
                if (enemy_value > piece_value) {
                    white_score += HIGH_VALUE_TRADE;
                }
            }
        }
    }


    /* 3. Evaluate black safety based on attacks & defenses */
    for (int i = 0; i < total_black; i++) {

        int square = black_attack_masks[i].square;
        int piece_type = black_attack_masks[i].piece_type;
        int piece_value = material_table[piece_type].midgame;
    
        Bitboard attackers = 0, defenders = 0;
    
        int total_attacker_value = 0;
        int total_defender_value = 0;
    
        int min_attacker_value = material_table[BQ].midgame;
        
        if (piece_type == BK) {
            piece_value = 3600;
        }

        // find white attackers
        for (int j = 0; j < total_white; j++) {
    
            // check if under attack
            if (white_attack_masks[j].attack_mask & (1ULL << square)) {
    
                // add enemy piece to attackers
                attackers |= (1ULL << white_attack_masks[j].square);
    
                // get material value of attacker
                int attacker_value = material_table[white_attack_masks[j].piece_type].midgame;
                
                // use black canon landing map cost for value
                if (white_attack_masks[j].piece_type == WF) {
                    attacker_value = white_canon_landing_cost[square];
                }

                if (white_attack_masks[j].piece_type == WK) {
                    attacker_value = 3600;
                }
                
                // track min max attacker value
                if (attacker_value < min_attacker_value) {
                    min_attacker_value = attacker_value;
                }

                // sum total attacker material
                total_attacker_value += attacker_value;
            }
        }
    
        // find black defenders
        for (int j = 0; j < total_black; j++) {
    
            // check if defending
            if (black_attack_masks[j].attack_mask & (1ULL << square)) {

                // add friendly piece to defenders
                defenders |= (1ULL << black_attack_masks[j].square);
    
                // get material value of defender
                int defender_value = material_table[black_attack_masks[j].piece_type].midgame;

                if (black_attack_masks[j].piece_type == BF) {
                    defender_value = black_canon_landing_cost[square];
                }
                
                if (black_attack_masks[j].piece_type == BK) {
                    defender_value = 3600;
                }
    
                // sum total defender material
                total_defender_value += defender_value;
            }
        }
        

        /* 3. Calculate Safety Rewards and Penalties for Black */
        // count total attackers
        int attacker_count = __builtin_popcountll(attackers);
        int defender_count = __builtin_popcountll(defenders);
    
        // (1) Penalty: if piece is under attack and not defended at all
        if (attacker_count > 0 && defender_count == 0) {
            black_score += EN_PRISE_PENALTY;
        }
    
        // (2) Penalty: if total attacker material is much greater than total defender material
        if (attacker_count > defender_count) {
            black_score += (attacker_count - defender_count) * WEAK_DEFENSE_PENALTY;
        }
    
        // (3) Penalty: if the piece being attacked has a higher score than the weakest attacker
        if (piece_value > min_attacker_value) {
            black_score +=  LOW_VALUE_TRADE;
        }
    
        // (4) Reward: if piece is well defended and attackers are weaker
        if (defender_count > attacker_count) {
            black_score += (defender_count - attacker_count) * STRONG_DEFENSE_BONUS;
        }

        // (5) Reward: if piece is well defended with less material cost
        if (defender_count > attacker_count && total_defender_value < total_attacker_value) {
            black_score += DEFENSE_EFFICIENCY_BONUS;
        }

        // (6) Penalty: if piece under attack by canon
        if (white_cannon_mask & (1ULL << square)) {
            black_score += UNDER_ENEMY_CANON_ATTACK;
        }


        /* 3. Calculate Attack Rewards for Black */

        // (1) Reward: encourage targeting enemy cannon movement mask
        if (black_attack_masks[i].attack_mask & white_canon_moves) {
            black_score += WATCHING_ENEMY_CANON;
        }

        // (2) Reward: encourage watching enemy king movement squares
        if (black_attack_masks[i].attack_mask & white_king_moves) {
            black_score += WATCHING_ENEMY_KING_MOVES;
        }


        // iterate over black pieces and compute scores
        Bitboard attack_mask = black_attack_masks[i].attack_mask;

        for (int j = 0; j < total_white; j++) {
            
            int enemy_square = white_attack_masks[j].square;
            int enemy_type = white_attack_masks[j].piece_type;
            int enemy_value = material_table[enemy_type].midgame;

            if (enemy_type == WK) {
                enemy_value = 3600;
            }

            if (attack_mask & (1ULL << enemy_square)) {
                
                // (3) Reward: encourage targeting enemy cannon 
                if (enemy_type == WC) {
                    black_score += ATTACKING_ENEMY_CANON;
                }

                // (4) Reward: attacking enemy king
                if (enemy_type == WK) {
                    black_score += CAPTURE_ENEMY_KING;
                }

                // count num defenders for enemy piece
                int enemy_defender_count = 0;
                for (int k = 0; k < total_white; k++) {
                    if (white_attack_masks[k].attack_mask & (1ULL << enemy_square)) {
                        enemy_defender_count++;
                    }
                }

                // (5) Reward: capturing enemy pieces that are undefended
                if (enemy_defender_count == 0) {
                    black_score += FREE_CAPTURE_BONUS;
                }
                // (6) Reward: general capture incentive
                else {
                    black_score += CAPTURE_BASE_BONUS;
                }

                // (7) Reward: attacking high-value pieces
                if (enemy_value > piece_value) {
                    black_score += HIGH_VALUE_TRADE;
                }
            }
        }

    }

    return (white_score - black_score) * color;
}
