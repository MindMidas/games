#include "gen_valid_boards.h"
#include "move_ordering_eval.h"


/*
 * Gen all possible legal boards/moves for the current player's turn.
 * board: Ptr to the current Chezzboard struct for the move.
 * color: 1 for white, -1 for black, to calculate move ordering score.
 * Returns ValidBoards struct containing all legal successor boards/moves.
 */
ValidBoards gen_chezz_boards(Chezzboard *board, int color) {

    /* 1. Initialize and setup bitboards */
    ValidBoards chezz_boards;
    init_chezz_boards(&chezz_boards);

    // assign white_pieces or black_pieces depending on turn
    Bitboard pieces = (board->header.turn == WHITE) ? board->white_pieces : board->black_pieces;

    // get bitboards for friendly, enemy, and all pieces
    Bitboard friendly = (board->header.turn == WHITE) ? board->white_pieces : board->black_pieces;
    Bitboard enemy = (board->header.turn == WHITE) ? board->black_pieces : board->white_pieces;

    
    /* 2. Generate moves for each piece */
    while (pieces) {
        
        // get LSB index
        int square = __builtin_ctzll(pieces);

        // clear LSB
        pieces &= (pieces - 1);
    
        // iterate over current player turn's pieces
        for (int piece_type = (board->header.turn == WHITE) ? 0 : 1; piece_type < TOTAL_TYPES; piece_type += 2) { 

            // check if the bit is flipped for that piece
            if ((board->pieces[piece_type] >> square) & 1) {
                
                
                // grab the pseudo-legal moves for non-sliding-pieces
                Bitboard nsp_pseudo_legal_moves = nsp_table[piece_type][square];

                // remove moves landing on friendly
                nsp_pseudo_legal_moves &= ~friendly;

                // call the generate move function for the piece type
                switch (piece_type) {
                    case WP: case BP: 
                        // set valid moves for peon
                        set_peon_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color); 
                        break;
                    case WN: case BN: 
                        // set valid moves for knight
                        set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color); 
                        break;
                    case WB: case BB: {
                        
                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = bishop_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for bishop
                        set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, color);
                        break;
                    }
                    case WR: case BR: {

                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = rook_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for rook
                        set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, color);
                        break;
                    }
                    case WQ: case BQ: {

                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = bishop_attacks(square, board->all_pieces) | rook_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for queen
                        set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, color); 
                        break;
                    }
                    case WK: case BK: 
                        // set valid moves for king
                        set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color); 
                        break;
                    case WZ: case BZ: 
                        // set valid moves for zombie
                        set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color); 
                        break;
                    case WF: case BF: {

                        // remove moves landing on enemy (catapult cannot capture)
                        nsp_pseudo_legal_moves &= ~enemy;
                        // set valid moves for catapult
                        set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color);
                        // set moves resulting for catapult fling
                        set_catapult_flings(board, square, piece_type, friendly, enemy, &chezz_boards, true, color);
                        break;
                    }
                    case WC: case BC: {

                        // remove moves landing on enemy (canon cannot capture)
                        nsp_pseudo_legal_moves &= ~enemy;
                        // set valid moves for canon
                        set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, color);
                        // set moves resulting for canon shots
                        set_canon_shots(board, square, friendly, enemy, &chezz_boards, color);
                        break;
                    }
                }
            }
        }
    }

    return chezz_boards;
}


/*
 * Init the valid board list.
 * chezz_boards: Ptr to ValidBoards to initialize.
 * Returns nothing.
 */
void init_chezz_boards(ValidBoards *chezz_boards) {
    chezz_boards->capacity = MAX_LEGAL_MOVES; // initial capacity 
    chezz_boards->count = 0;
    chezz_boards->next_index = 0;
    chezz_boards->boards = malloc(chezz_boards->capacity * sizeof(Chezzboard));
}


/*
 * Adds a new board to the valid board list.
 * chezz_boards: Ptr to ValidBoards to update.
 * new_board: Ptr to the new Chezzboard to add.
 * color: 1 for white, -1 for black.
 * Returns nothing.
 * Note: Copies the entire Chezzboard struct into the list.
 */
void add_board(ValidBoards *chezz_boards, Chezzboard *new_board, bool eval, int color) {
    
    // resize if necessary
    if (chezz_boards->count >= chezz_boards->capacity) {
        chezz_boards->capacity += 50;
        chezz_boards->boards = realloc(chezz_boards->boards, chezz_boards->capacity * sizeof(Chezzboard));
    }

    // add move count
    new_board->header.num_moves += 1;

    // update turn
    new_board->header.turn = (new_board->header.turn == WHITE) ? BLACK : WHITE;

    // get score for board
    if (eval) {
        new_board->score = move_ordering_eval(new_board, color);
    } else {
        new_board->score = 0;
    }

    // copy new board into the chezz_boards and post increment count
    chezz_boards->boards[chezz_boards->count++] = *new_board;


}


/*
 * Frees allocated memory for the valid board list.
 * chezz_boards: Ptr to ValidBoards to free.
 * Returns nothing.
 */
void free_chezz_boards(ValidBoards *chezz_boards) {
    free(chezz_boards->boards);
    chezz_boards->boards = NULL;
    chezz_boards->count = 0;
    chezz_boards->capacity = 0;
}


/*
 * Moves a piece on the board, updating all relevant bitboards.
 * board: Ptr to the Chezzboard to modify.
 * piece_type: Type of piece to move.
 * from: Starting square index (0-63).
 * to: Target square index (0-63).
 * Returns nothing.
 */
void move_piece(Chezzboard *board, int piece_type, int from, int to) {
    
    // create bitmask and invert, and use bitwise AND to clear target bit
    board->pieces[piece_type] &= ~(1ULL << from);

    // create bitmask and use bitwise OR to set target bit
    board->pieces[piece_type] |= (1ULL << to);

    // update Chezzboard struct and combine two bit masks into one piece mask
    Bitboard piece_mask = (1ULL << from) | (1ULL << to);
    
    // (bitwise XOR) flips bits where piece_mask has 1s, clearing old and setting new pos
    if (board->header.turn == WHITE) {
        board->white_pieces ^= piece_mask;
    } else {
        board->black_pieces ^= piece_mask;
    }
    board->all_pieces ^= piece_mask;
}


/*
 * Captures a piece, removing it from the board.
 * board: Ptr to the Chezzboard to modify.
 * target: Square index (0-63) of the piece to capture.
 * Returns nothing.
 */
void capture_piece(Chezzboard *board, int target) {

    // iterate over all piece types
    for (int i = 0; i < TOTAL_TYPES; i++) {

        // check if there's a piece at the target square
        if ((board->pieces[i] >> target) & 1) {

            // remove the piece and leave other bits unchanged
            // create bitmask and invert (~), and use bitwise AND to clear target bit
            board->pieces[i] &= ~(1ULL << target);

            break;
        }
    }

    // remove piece from respective bitboards
    Bitboard piece_mask = (1ULL << target);
    board->black_pieces &= ~piece_mask;
    board->white_pieces &= ~piece_mask;
    board->all_pieces &= ~piece_mask;
}


/*
 * Adds valid peon moves to the valid board list.
 * board: Ptr to the current Chezzboard.
 * square: Starting square index (0-63).
 * piece_type: Type of peon (WP or BP).
 * pseudo_legal_moves: Bitboard of pseudo-legal moves.
 * enemy: Bitboard of enemy pieces.
 * chezz_boards: Ptr to ValidBoards to update.
 * color: 1 for white, -1 for black.
 * Returns nothing.
 */
void set_peon_moves(Chezzboard *board, 
                    int square,
                    int piece_type,
                    Bitboard pseudo_legal_moves, 
                    Bitboard enemy, 
                    ValidBoards *chezz_boards,
                    int color) {
    
    /* 1. Process forward moves */
    // compute row & column of current peon
    int col = square % 8;

    // process each valid move in pseudo_legal_moves
    for (Bitboard moves = pseudo_legal_moves; moves; moves &= (moves - 1)) {
        
        // get index of LSB
        int target = __builtin_ctzll(moves);

        // set new target col and row
        int target_col = target % 8;
        int target_row = target / 8;

        /* 2. Handle forward move (no capture) */
        if (target_col == col && !((enemy >> target) & 1)) { 
            
            // copy board
            Chezzboard new_board = *board;

            // move peon
            move_piece(&new_board, piece_type, square, target);

            // handle contagion
            handle_contagion(&new_board);

            // handle promotion
            if ((target_row == 7) || (target_row == 0)) {
                promote_peons(&new_board);
            }
            
            // add board to chezz_boards
            add_board(chezz_boards, &new_board, true, color);

        }

        /* 3. Handle diagonal capture */
        else if (abs(target_col - col) == 1 && (enemy >> target) & 1) { 

            // copy board
            Chezzboard new_board = *board;

            // capture enemy piece
            capture_piece(&new_board, target);

            // move peon
            move_piece(&new_board, piece_type, square, target);

            // handle contagion
            handle_contagion(&new_board);

            // handle promotion
            if ((target_row == 7) || (target_row == 0)) {
                promote_peons(&new_board);
            }

            // add board to chezz_boards
            add_board(chezz_boards, &new_board, true, color);
        }
    }
}


/*
 * Adds valid moves for standard pieces (knight, bishop, rook, queen, king, catapult, canon) to the valid board list.
 * board: Ptr to the current Chezzboard.
 * square: Starting square index (0-63).
 * piece_type: Type of piece.
 * pseudo_legal_moves: Bitboard of pseudo-legal moves.
 * enemy: Bitboard of enemy pieces.
 * chezz_boards: Ptr to ValidBoards to update.
 * color: 1 for white, -1 for black.
 * Returns nothing.
 */
void set_piece_moves(Chezzboard *board, 
                     int square, 
                     int piece_type,
                     Bitboard pseudo_legal_moves,
                     Bitboard enemy,
                     ValidBoards *chezz_boards,
                     int color) {
    
    // process each valid move in pseudo_legal_moves
    for (Bitboard moves = pseudo_legal_moves; moves; moves &= (moves - 1)) {
        
        // get LSB index
        int target = __builtin_ctzll(moves);
        
        // copy board
        Chezzboard new_board = *board;

        // if enemy piece at target, capture
        if ((enemy >> target) & 1) {
            capture_piece(&new_board, target);
        }

        // move piece
        move_piece(&new_board, piece_type, square, target);

        // handle contagion
        handle_contagion(&new_board);

        // add board to chezz_boards
        add_board(chezz_boards, &new_board, true, color);
    }
}


/*
 * Adds valid catapult fling moves to the valid board list.
 * board: Ptr to the current Chezzboard.
 * square: Starting square index (0-63) of the catapult.
 * piece_type: Type of catapult (WF or BF).
 * friendly: Bitboard of friendly pieces.
 * enemy: Bitboard of enemy pieces.
 * chezz_boards: Ptr to ValidBoards to update.
 * color: 1 for white, -1 for black.
 * Returns nothing.
 */
void set_catapult_flings(Chezzboard *board, 
                         int square, 
                         int piece_type,
                         Bitboard friendly,
                         Bitboard enemy,
                         ValidBoards *chezz_boards,
                         bool evaluate,
                         int color) {
    
    /* 1. Identify adjacent friendly pieces */
    // get adjacent pos 
    Bitboard adjacent_pieces = nsp_table[piece_type][square];

    // remove adjacent pos where there's enemies (catapult can only fling friendly)
    adjacent_pieces &= ~enemy;

    // keep only adjacent pos that have friendly pieces
    adjacent_pieces &= friendly;


    // fling each piece in adjacent_pieces
    while (adjacent_pieces) {

        // get index of LSB (index of friendly piece)
        int friendly_square = __builtin_ctzll(adjacent_pieces);

        // remove LSB
        adjacent_pieces &= (adjacent_pieces - 1);

        // set (x,y) for catapult and friendly piece
        int catapult_row = square / 8;
        int catapult_col = square % 8;
        int friendly_row   = friendly_square / 8;
        int friendly_col   = friendly_square % 8;

        // figure out opposite direction relative to catapult square
        int dx = catapult_col - friendly_col;
        int dy = catapult_row - friendly_row;

        // the first index where the flung piece can land
        int new_row = catapult_row + dy;
        int new_col = catapult_col + dx;

        // convert to square
        int new_square = new_row * 8 + new_col;


        /* 2. Compute fling moves */
        // grab the moves for catapult which will act as blockers
        Bitboard sim_blockers = nsp_table[piece_type][square];

        // remove blocker in direction of fling
        sim_blockers &= ~(1ULL << new_square);

        // basically a bishop attack for diagonals or rook attack for vertical/horizontal
        Bitboard fling_moves;

        if (dx != 0 && dy != 0) {
            fling_moves = bishop_attacks(square, sim_blockers);
        } else {
            fling_moves = rook_attacks(square, sim_blockers);
        }

        // get rid of sim_blockers moves
        fling_moves &= ~sim_blockers;

        // get rid of friendly piece moves (flung piece can only land on enemy)
        fling_moves &= ~friendly;
        

        /* 3. Identify flung piece and process moves */
        // figure out which piece is being flung
        int fling_piece_type = -1;

        // get rid of flung piece landing on enemy king
        Bitboard enemy_king;

        if (piece_type == WF) {
            
            // set enemy_king
            enemy_king = board->pieces[BK];

            // find fling_piece_type on chezz board (we know its white)
            for (int i = 0; i < TOTAL_TYPES; i += 2) {
                if ((board->pieces[i] >> friendly_square) & 1) {
                    fling_piece_type = i;
                    break;
                }
            }

        } else {

            // set enemy_king
            enemy_king = board->pieces[WK];

            // find fling_piece_type on chezz board (we know its black)
            for (int i = 1; i < TOTAL_TYPES; i += 2) {
                if ((board->pieces[i] >> friendly_square) & 1) {
                    fling_piece_type = i;
                    break;
                }
            }
        }

        fling_moves &= ~enemy_king;


        /* 4. Apply fling moves */
        while(fling_moves) {

            // get index of LSB
            int target = __builtin_ctzll(fling_moves);

            // remove LSB
            fling_moves &= (fling_moves - 1);
            
            // copy board
            Chezzboard new_board = *board;

            // if enemy piece at target, capture and destroy flung piece
            if ((enemy >> target) & 1) {
                capture_piece(&new_board, target);
                capture_piece(&new_board, friendly_square);
            } else {
                // else fling piece
                move_piece(&new_board, fling_piece_type, friendly_square, target);
            }

            // handle contagion
            handle_contagion(&new_board);

            // promote peons
            if ((fling_piece_type == WP) || (fling_piece_type == BP)) {
                promote_peons(&new_board);
            }

            // add board to chezz_boards
            add_board(chezz_boards, &new_board, evaluate, color);

        }
    }
}


/*
 * Adds valid canon shot moves to the valid board list.
 * board: Ptr to the current Chezzboard.
 * square: Starting square index (0-63) of the canon.
 * friendly: Bitboard of friendly pieces.
 * enemy: Bitboard of enemy pieces.
 * chezz_boards: Ptr to ValidBoards to update.
 * color: 1 for white, -1 for black.
 * Returns nothing.
 */
void set_canon_shots(Chezzboard *board, 
                         int square, 
                         Bitboard friendly,
                         Bitboard enemy, 
                         ValidBoards *chezz_boards,
                         int color) {
    
    /* 1. Setup canon shot directions */
    // keep track of null shot
    int is_null = 1;

    // shot direction
    int directions[4][2] = {
        {1, 1},
        {-1, 1},
        {1, -1},
        {-1, -1}
    };

    // set canon row and column
    int canon_row = square / 8;
    int canon_col = square % 8;


    /* 2. Process each shot direction */
    for (int d = 0; d < 4; d++) {

        // calculate the first index in chezz board of canon shot direction
        int new_col = canon_col + directions[d][0];
        int new_row = canon_row + directions[d][1];
        int new_square = new_row * 8 + new_col;

        // grab the moves for catapult which will act as blockers
        Bitboard sim_blockers = nsp_table[WF][square];

        // remove blocker in direction of shot
        sim_blockers &= ~(1ULL << new_square);

        // canon shot is basically bishop attacking an empty diagonal
        Bitboard shot_path = queen_attacks(square, sim_blockers);
        
        // remove sim_blocker bits as shot is only the diagonal
        shot_path &= ~sim_blockers;

        // copy board
        Chezzboard new_board = *board;


        /* 3. Apply captures along shot path */
        while(shot_path) {

            // get index of LSB
            int target = __builtin_ctzll(shot_path);

            // remove LSB
            shot_path &= (shot_path - 1);

            // if enemy or friendly piece at target, capture
            if (((enemy >> target) & 1) || ((friendly >> target) & 1)) {
                
                capture_piece(&new_board, target);

                // set to false since we captured
                is_null = 0;
            }
        }

        /* 4. Add board if shot not null */
        if(!is_null) {

            // handle contagion
            handle_contagion(&new_board);
            
            // add board to chezz boards
            add_board(chezz_boards, &new_board, true, color);

            is_null = 1;
        }
    }
}


/*
 * Promotes peons to zombies based on turn and row (0 or 7).
 * board: Ptr to the Chezzboard to modify.
 * Returns nothing.
 */
void promote_peons(Chezzboard *board) {

    // check peons at row 0 or 7 depending on who's turn it is
    if (board->header.turn == WHITE) {

        // mask row 7 and take bitwise AND of wP
        Bitboard white_promotions = board->pieces[WP] & 0xFF00000000000000ULL;
        
        // remove promoted peons from WP
        board->pieces[WP] &= ~white_promotions;
        
        // add promoted peons to WZ
        board->pieces[WZ] |= white_promotions; 

    } else {
        
        // mask row 0 and take bitwise AND of bP
        Bitboard black_promotions = board->pieces[BP] & 0xFFULL;
        
        // remove promoted peons from BP
        board->pieces[BP] &= ~black_promotions;
        
        // add promoted peons to BZ
        board->pieces[BZ] |= black_promotions; 
    }
}


/*
 * Handles contagion, converting adjacent enemy pieces to friendly zombies.
 * board: Ptr to the Chezzboard to modify.
 * Returns nothing.
 */
void handle_contagion(Chezzboard *board) {

    /* 1. Setup zombie and enemy bitboards */
    // get friendly and enemy zombie bitboards
    Bitboard friendly_zombies = (board->header.turn == WHITE) ? board->pieces[WZ] : board->pieces[BZ];
    Bitboard enemy_zombies = (board->header.turn == WHITE) ? board->pieces[BZ] : board->pieces[WZ];

    // kings are immune
    Bitboard enemy_king = (board->header.turn == WHITE) ? board->pieces[BK] : board->pieces[WK];

    // get enemy pieces
    Bitboard enemy_pieces = (board->header.turn == WHITE) ? board->black_pieces : board->white_pieces;


    /* 2. Compute contagion mask */
    // set bitboard masks for shifting (up, down, left, right)
    Bitboard up = friendly_zombies << 8;
    Bitboard down = friendly_zombies >> 8;
    
    // prevent wrap around
    Bitboard left = (friendly_zombies & ~COL_A) >> 1;
    Bitboard right = (friendly_zombies & ~COL_H) << 1;

    // get adjacent enemy pieces to friendly zombies
    Bitboard contagion_mask = (up | down | left | right) & enemy_pieces;

    // remove immune pieces
    contagion_mask &= ~(enemy_king | enemy_zombies);

    // if no infections, return
    if (!contagion_mask) {
        return;
    }

    /* 3. Apply contagion to enemy pieces */
    // loop over enemy pieces
    for (int i = (board->header.turn == WHITE) ? 1 : 0; i < TOTAL_TYPES; i += 2) { 
        
        // skip king and zombie piece types
        if (i == BK || i == WK || i == BZ || i == WZ) {
            continue;
        }
        // remove infected pieces
        board->pieces[i] &= ~contagion_mask;
    }


    /* 4. Update board state */
    // update enemy and all_pieces bitboards
    if (board->header.turn == WHITE) {

        // remove converted pieces from black
        board->black_pieces &= ~contagion_mask;
        // add them to white pieces
        board->white_pieces |= contagion_mask;
        // add them as black zombies
        board->pieces[WZ] |= contagion_mask;

    } else {

        // remove converted pieces from white
        board->white_pieces &= ~contagion_mask;
        // add them to black pieces
        board->black_pieces |= contagion_mask;
        // add them as white zombies
        board->pieces[BZ] |= contagion_mask;
    }

    // Update all_pieces to reflect the transformation
    board->all_pieces = board->white_pieces | board->black_pieces;
}


/*
 * Compares two Chezzboards for equality.
 * board1: Ptr to the first Chezzboard.
 * board2: Ptr to the second Chezzboard.
 * Returns 1 if equal, 0 if not.
 */
int equal(const Chezzboard *board1, const Chezzboard *board2) {
    
    // boards don't match
    if (board1->white_pieces != board2->white_pieces ||
        board1->black_pieces != board2->black_pieces ||
        memcmp(board1->pieces, board2->pieces, sizeof(board1->pieces)) != 0 ||
        board1->all_pieces != board2->all_pieces || 
        board1->header.turn != board2->header.turn) {
        
            return false;
    }
    
    // matching boards
    return true;
}

