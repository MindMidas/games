#include "user_actions.h"
#include "move_ordering_eval.h"

/*
 * Dynamic event buffer used to collect ordered events while constructing one successor board.
 */
typedef struct UAEventBuffer {
    UAEvent *items;
    size_t count;
    size_t capacity;
} UAEventBuffer;


/* Internal helper declarations. */
static ValidBoards ua_gen_chezz_boards_raw(Chezzboard *board, UAValidBoards *chezz_actions, int color);
static void ua_init_chezz_actions(UAValidBoards *chezz_actions);
static void ua_init_chezz_boards(ValidBoards *chezz_boards);
static void ua_add_board(
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    Chezzboard *new_board,
    const UAAction *action,
    const UAEvent *events,
    size_t event_count,
    bool eval,
    int color
);
static void ua_set_peon_moves(
    Chezzboard *board,
    int square,
    int piece_type,
    Bitboard pseudo_legal_moves,
    Bitboard enemy,
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    int color
);
static void ua_set_piece_moves(
    Chezzboard *board,
    int square,
    int piece_type,
    Bitboard pseudo_legal_moves,
    Bitboard enemy,
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    int color
);
static void ua_set_catapult_flings(
    Chezzboard *board,
    int square,
    int piece_type,
    Bitboard friendly,
    Bitboard enemy,
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    bool evaluate,
    int color
);
static void ua_set_canon_shots(
    Chezzboard *board,
    int square,
    Bitboard friendly,
    Bitboard enemy,
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    int color
);
static void ua_move_piece_with_events(Chezzboard *board, int piece_type, int from, int to, UAEventBuffer *events);
static void ua_capture_piece_with_events(Chezzboard *board, int target, UAEventBuffer *events);
static void ua_promote_peons_with_events(Chezzboard *board, UAEventBuffer *events);
static void ua_handle_contagion_with_events(Chezzboard *board, UAEventBuffer *events);


/* Initializes an event buffer. */
static void ua_event_buffer_init(UAEventBuffer *events) {
    events->count = 0;
    events->capacity = 8;
    events->items = malloc(events->capacity * sizeof(UAEvent));
}


/* Frees memory used by an event buffer. */
static void ua_event_buffer_free(UAEventBuffer *events) {
    free(events->items);
    events->items = NULL;
    events->count = 0;
    events->capacity = 0;
}


/* Pushes an event into the buffer, resizing as needed. */
static void ua_event_buffer_push(UAEventBuffer *events, const UAEvent *event) {
    if (events == NULL || event == NULL) {
        return;
    }
    if (events->count >= events->capacity) {
        events->capacity += 8;
        events->items = realloc(events->items, events->capacity * sizeof(UAEvent));
    }
    events->items[events->count++] = *event;
}


/*
 * Pushes the leading action event (e.g. canon_shot, catapult_fling) to preserve main.py ordering.
 */
static void ua_push_action_event(UAEventBuffer *events, const UAAction *action, const char *action_name) {
    if (events == NULL || action == NULL || action_name == NULL) {
        return;
    }
    UAEvent event;
    memset(&event, 0, sizeof(event));
    event.type = UA_EVENT_ACTION;
    snprintf(event.action, sizeof(event.action), "%s", action_name);
    event.square = action->square;
    event.to_square = action->to;
    event.payload_square = action->payload;
    event.target_square = action->target;
    snprintf(event.direction, sizeof(event.direction), "%s", action->direction);
    ua_event_buffer_push(events, &event);
}


/* Converts square index (0-63) to algebraic notation (e.g. e4). */
static void ua_square_to_notation(int square, char out[3]) {
    out[0] = (char)('a' + (square % 8));
    out[1] = (char)('1' + (square / 8));
    out[2] = '\0';
}


/* Builds action_key using the same format as the Python rules adapter. */
static void ua_build_action_key(UAAction *action) {
    char from[3] = "";
    char to[3] = "";
    char square[3] = "";
    char payload[3] = "";
    char target[3] = "";

    action->action_key[0] = '\0';

    switch (action->kind) {
        case UA_ACTION_MOVE:
            ua_square_to_notation(action->from, from);
            ua_square_to_notation(action->to, to);
            snprintf(action->action_key, sizeof(action->action_key), "move:%s>%s", from, to);
            break;
        case UA_ACTION_SHOOT:
            ua_square_to_notation(action->square, square);
            snprintf(action->action_key, sizeof(action->action_key), "shoot:%s:%s", square, action->direction);
            break;
        case UA_ACTION_FLING:
            ua_square_to_notation(action->square, square);
            ua_square_to_notation(action->payload, payload);
            ua_square_to_notation(action->target, target);
            snprintf(action->action_key, sizeof(action->action_key), "fling:%s:%s>%s", square, payload, target);
            break;
        default:
            snprintf(action->action_key, sizeof(action->action_key), "unknown");
            break;
    }
}


/* Creates a move action payload. */
static UAAction ua_make_move_action(int from, int to) {
    UAAction action;
    memset(&action, 0, sizeof(action));
    action.kind = UA_ACTION_MOVE;
    action.from = from;
    action.to = to;
    ua_build_action_key(&action);
    return action;
}


/* Creates a cannon shot action payload. */
static UAAction ua_make_shoot_action(int square, const char *direction) {
    UAAction action;
    memset(&action, 0, sizeof(action));
    action.kind = UA_ACTION_SHOOT;
    action.square = square;
    snprintf(action.direction, sizeof(action.direction), "%s", direction);
    ua_build_action_key(&action);
    return action;
}


/* Creates a catapult fling action payload. */
static UAAction ua_make_fling_action(int catapult, int payload, int target) {
    UAAction action;
    memset(&action, 0, sizeof(action));
    action.kind = UA_ACTION_FLING;
    action.square = catapult;
    action.payload = payload;
    action.target = target;
    ua_build_action_key(&action);
    return action;
}


/*
 * Init the user-action result buffers.
 * chezz_actions: Ptr to UAValidBoards to initialize.
 * Returns nothing.
 */
static void ua_init_chezz_actions(UAValidBoards *chezz_actions) {
    chezz_actions->capacity = MAX_LEGAL_MOVES;
    chezz_actions->count = 0;
    chezz_actions->boards = NULL;
    chezz_actions->actions = malloc(chezz_actions->capacity * sizeof(UAAction));
    chezz_actions->event_offsets = malloc(chezz_actions->capacity * sizeof(size_t));
    chezz_actions->event_counts = malloc(chezz_actions->capacity * sizeof(size_t));
    chezz_actions->events_count = 0;
    chezz_actions->events_capacity = chezz_actions->capacity * 8;
    chezz_actions->events = malloc(chezz_actions->events_capacity * sizeof(UAEvent));
}


/*
 * Frees user-action result buffers.
 * chezz_actions: Ptr to UAValidBoards to free.
 * Returns nothing.
 */
void ua_free_chezz_actions(UAValidBoards *chezz_actions) {
    if (chezz_actions == NULL) {
        return;
    }

    free(chezz_actions->boards);
    free(chezz_actions->actions);
    free(chezz_actions->events);
    free(chezz_actions->event_offsets);
    free(chezz_actions->event_counts);
    chezz_actions->boards = NULL;
    chezz_actions->actions = NULL;
    chezz_actions->events = NULL;
    chezz_actions->event_offsets = NULL;
    chezz_actions->event_counts = NULL;
    chezz_actions->count = 0;
    chezz_actions->capacity = 0;
    chezz_actions->events_count = 0;
    chezz_actions->events_capacity = 0;
}


/*
 * Gen all possible legal boards for the current player and attach per-board action/event metadata.
 * board: Ptr to the current Chezzboard struct for the move.
 * color: 1 for white, -1 for black, to calculate move ordering score.
 * Returns uAValidBoards containing successor boards plus action/event payloads.
 */
UAValidBoards ua_gen_chezz_boards(Chezzboard *board, int color) {
    UAValidBoards chezz_actions;
    ua_init_chezz_actions(&chezz_actions);

    ValidBoards chezz_boards = ua_gen_chezz_boards_raw(board, &chezz_actions, color);

    chezz_actions.boards = chezz_boards.boards;
    chezz_actions.count = chezz_boards.count;
    chezz_actions.capacity = chezz_boards.capacity;
    return chezz_actions;
}


/*
 * Internal raw board generator used by ua_gen_chezz_boards.
 * board: Ptr to the current Chezzboard.
 * chezz_actions: Ptr to action/event output container.
 * color: 1 for white, -1 for black, to calculate move ordering score.
 * Returns ValidBoards containing successor boards.
 */
static ValidBoards ua_gen_chezz_boards_raw(Chezzboard *board, UAValidBoards *chezz_actions, int color) {

    /* 1. Initialize and setup bitboards */
    ValidBoards chezz_boards;
    ua_init_chezz_boards(&chezz_boards);

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
                        ua_set_peon_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color); 
                        break;
                    case WN: case BN: 
                        // set valid moves for knight
                        ua_set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color); 
                        break;
                    case WB: case BB: {
                        
                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = bishop_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for bishop
                        ua_set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color);
                        break;
                    }
                    case WR: case BR: {

                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = rook_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for rook
                        ua_set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color);
                        break;
                    }
                    case WQ: case BQ: {

                        // get the pseudo-legal moves
                        Bitboard sp_pseudo_legal_moves = bishop_attacks(square, board->all_pieces) | rook_attacks(square, board->all_pieces);
                        // remove moves landing on friendly
                        sp_pseudo_legal_moves &= ~friendly;
                        // set valid moves for queen
                        ua_set_piece_moves(board, square, piece_type, sp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color); 
                        break;
                    }
                    case WK: case BK: 
                        // set valid moves for king
                        ua_set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color); 
                        break;
                    case WZ: case BZ: 
                        // set valid moves for zombie
                        ua_set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color); 
                        break;
                    case WF: case BF: {

                        // remove moves landing on enemy (catapult cannot capture)
                        nsp_pseudo_legal_moves &= ~enemy;
                        // set valid moves for catapult
                        ua_set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color);
                        // set moves resulting for catapult fling
                        ua_set_catapult_flings(board, square, piece_type, friendly, enemy, &chezz_boards, chezz_actions, true, color);
                        break;
                    }
                    case WC: case BC: {

                        // remove moves landing on enemy (canon cannot capture)
                        nsp_pseudo_legal_moves &= ~enemy;
                        // set valid moves for canon
                        ua_set_piece_moves(board, square, piece_type, nsp_pseudo_legal_moves, enemy, &chezz_boards, chezz_actions, color);
                        // set moves resulting for canon shots
                        ua_set_canon_shots(board, square, friendly, enemy, &chezz_boards, chezz_actions, color);
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
static void ua_init_chezz_boards(ValidBoards *chezz_boards) {
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
static void ua_add_board(
    ValidBoards *chezz_boards,
    UAValidBoards *chezz_actions,
    Chezzboard *new_board,
    const UAAction *action,
    const UAEvent *events,
    size_t event_count,
    bool eval,
    int color
) {
    size_t board_index = chezz_boards->count;
    
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

    if (chezz_actions != NULL && action != NULL) {
        if (board_index >= chezz_actions->capacity) {
            chezz_actions->capacity += 50;
            chezz_actions->actions = realloc(chezz_actions->actions, chezz_actions->capacity * sizeof(UAAction));
            chezz_actions->event_offsets = realloc(chezz_actions->event_offsets, chezz_actions->capacity * sizeof(size_t));
            chezz_actions->event_counts = realloc(chezz_actions->event_counts, chezz_actions->capacity * sizeof(size_t));
        }
        chezz_actions->actions[board_index] = *action;
        chezz_actions->event_offsets[board_index] = chezz_actions->events_count;
        chezz_actions->event_counts[board_index] = event_count;

        if (event_count > 0 && events != NULL) {
            while (chezz_actions->events_count + event_count > chezz_actions->events_capacity) {
                chezz_actions->events_capacity += chezz_actions->capacity * 4;
                chezz_actions->events = realloc(chezz_actions->events, chezz_actions->events_capacity * sizeof(UAEvent));
            }
            memcpy(
                chezz_actions->events + chezz_actions->events_count,
                events,
                event_count * sizeof(UAEvent)
            );
            chezz_actions->events_count += event_count;
        }
        chezz_actions->count = chezz_boards->count;
    }

}


/*
 * Moves a piece on the board, updating all relevant bitboards.
 * board: Ptr to the Chezzboard to modify.
 * piece_type: Type of piece to move.
 * from: Starting square index (0-63).
 * to: Target square index (0-63).
 * Returns nothing.
 */
static void ua_move_piece_with_events(Chezzboard *board, int piece_type, int from, int to, UAEventBuffer *events) {
    
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

    if (events != NULL) {
        UAEvent event;
        memset(&event, 0, sizeof(event));
        event.type = UA_EVENT_MOVE;
        snprintf(event.piece, sizeof(event.piece), "%s", piece_lookup[piece_type]);
        event.from_square = from;
        event.to_square = to;
        ua_event_buffer_push(events, &event);
    }
}

static void ua_capture_piece_with_events(Chezzboard *board, int target, UAEventBuffer *events) {

    // iterate over all piece types
    for (int i = 0; i < TOTAL_TYPES; i++) {

        // check if there's a piece at the target square
        if ((board->pieces[i] >> target) & 1) {
            if (events != NULL) {
                UAEvent event;
                memset(&event, 0, sizeof(event));
                event.type = UA_EVENT_CAPTURE;
                event.square = target;
                snprintf(event.piece, sizeof(event.piece), "%s", piece_lookup[i]);
                ua_event_buffer_push(events, &event);
            }

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
static void ua_set_peon_moves(Chezzboard *board, 
                    int square,
                    int piece_type,
                    Bitboard pseudo_legal_moves, 
                    Bitboard enemy, 
                    ValidBoards *chezz_boards,
                    UAValidBoards *chezz_actions,
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
            UAEventBuffer events;
            ua_event_buffer_init(&events);

            // move peon
            ua_move_piece_with_events(&new_board, piece_type, square, target, &events);

            // handle contagion
            ua_handle_contagion_with_events(&new_board, &events);

            // handle promotion
            if ((target_row == 7) || (target_row == 0)) {
                ua_promote_peons_with_events(&new_board, &events);
            }
            
            // add board to chezz_boards
            UAAction action = ua_make_move_action(square, target);
            ua_add_board(chezz_boards, chezz_actions, &new_board, &action, events.items, events.count, true, color);
            ua_event_buffer_free(&events);

        }

        /* 3. Handle diagonal capture */
        else if (abs(target_col - col) == 1 && (enemy >> target) & 1) { 

            // copy board
            Chezzboard new_board = *board;
            UAEventBuffer events;
            ua_event_buffer_init(&events);

            // capture enemy piece
            ua_capture_piece_with_events(&new_board, target, &events);

            // move peon
            ua_move_piece_with_events(&new_board, piece_type, square, target, &events);

            // handle contagion
            ua_handle_contagion_with_events(&new_board, &events);

            // handle promotion
            if ((target_row == 7) || (target_row == 0)) {
                ua_promote_peons_with_events(&new_board, &events);
            }

            // add board to chezz_boards
            UAAction action = ua_make_move_action(square, target);
            ua_add_board(chezz_boards, chezz_actions, &new_board, &action, events.items, events.count, true, color);
            ua_event_buffer_free(&events);
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
static void ua_set_piece_moves(Chezzboard *board, 
                     int square, 
                     int piece_type,
                     Bitboard pseudo_legal_moves,
                     Bitboard enemy,
                     ValidBoards *chezz_boards,
                     UAValidBoards *chezz_actions,
                     int color) {
    
    // process each valid move in pseudo_legal_moves
    for (Bitboard moves = pseudo_legal_moves; moves; moves &= (moves - 1)) {
        
        // get LSB index
        int target = __builtin_ctzll(moves);
        
        // copy board
        Chezzboard new_board = *board;
        UAEventBuffer events;
        ua_event_buffer_init(&events);

        if (piece_type == WF || piece_type == BF) {
            UAAction action = ua_make_move_action(square, target);
            ua_push_action_event(&events, &action, "catapult_move");
        } else if (piece_type == WC || piece_type == BC) {
            UAAction action = ua_make_move_action(square, target);
            ua_push_action_event(&events, &action, "canon_move");
        }

        // if enemy piece at target, capture
        if ((enemy >> target) & 1) {
            ua_capture_piece_with_events(&new_board, target, &events);
        }

        // move piece
        ua_move_piece_with_events(&new_board, piece_type, square, target, &events);

        // handle contagion
        ua_handle_contagion_with_events(&new_board, &events);

        // add board to chezz_boards
        UAAction action = ua_make_move_action(square, target);
        ua_add_board(chezz_boards, chezz_actions, &new_board, &action, events.items, events.count, true, color);
        ua_event_buffer_free(&events);
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
static void ua_set_catapult_flings(Chezzboard *board, 
                         int square, 
                         int piece_type,
                         Bitboard friendly,
                         Bitboard enemy,
                         ValidBoards *chezz_boards,
                         UAValidBoards *chezz_actions,
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
            UAEventBuffer events;
            ua_event_buffer_init(&events);

            UAAction action = ua_make_fling_action(square, friendly_square, target);
            ua_push_action_event(&events, &action, "catapult_fling");

            // if enemy piece at target, capture and destroy flung piece
            if ((enemy >> target) & 1) {
                ua_capture_piece_with_events(&new_board, target, &events);
                ua_capture_piece_with_events(&new_board, friendly_square, &events);
            } else {
                // else fling piece
                ua_move_piece_with_events(&new_board, fling_piece_type, friendly_square, target, &events);
            }

            // handle contagion
            ua_handle_contagion_with_events(&new_board, &events);

            // promote peons
            if ((fling_piece_type == WP) || (fling_piece_type == BP)) {
                ua_promote_peons_with_events(&new_board, &events);
            }

            // add board to chezz_boards
            ua_add_board(chezz_boards, chezz_actions, &new_board, &action, events.items, events.count, evaluate, color);
            ua_event_buffer_free(&events);

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
static void ua_set_canon_shots(Chezzboard *board, 
                         int square, 
                         Bitboard friendly,
                         Bitboard enemy, 
                         ValidBoards *chezz_boards,
                         UAValidBoards *chezz_actions,
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
        const char *direction_label = NULL;
        if (d == 0) direction_label = "tr";
        else if (d == 1) direction_label = "tl";
        else if (d == 2) direction_label = "br";
        else direction_label = "bl";

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
        UAEventBuffer events;
        ua_event_buffer_init(&events);
        UAAction action = ua_make_shoot_action(square, direction_label);
        ua_push_action_event(&events, &action, "canon_shot");


        /* 3. Apply captures along shot path */
        while(shot_path) {

            // get index of LSB
            int target = __builtin_ctzll(shot_path);

            // remove LSB
            shot_path &= (shot_path - 1);

            // if enemy or friendly piece at target, capture
            if (((enemy >> target) & 1) || ((friendly >> target) & 1)) {
                // set to false since we captured
                is_null = 0;
                ua_capture_piece_with_events(&new_board, target, &events);
            }
        }

        /* 4. Add board if shot not null */
        if(!is_null) {

            // handle contagion
            ua_handle_contagion_with_events(&new_board, &events);
            
            // add board to chezz boards
            ua_add_board(chezz_boards, chezz_actions, &new_board, &action, events.items, events.count, true, color);

            is_null = 1;
        }
        ua_event_buffer_free(&events);
    }
}


/*
 * Promotes peons to zombies based on turn and row (0 or 7).
 * board: Ptr to the Chezzboard to modify.
 * Returns nothing.
 */
static void ua_promote_peons_with_events(Chezzboard *board, UAEventBuffer *events) {

    // check peons at row 0 or 7 depending on who's turn it is
    if (board->header.turn == WHITE) {

        // mask row 7 and take bitwise AND of wP
        Bitboard white_promotions = board->pieces[WP] & 0xFF00000000000000ULL;

        if (events != NULL) {
            for (Bitboard promoted = white_promotions; promoted; promoted &= (promoted - 1)) {
                int square = __builtin_ctzll(promoted);
                UAEvent event;
                memset(&event, 0, sizeof(event));
                event.type = UA_EVENT_PROMOTION;
                event.square = square;
                snprintf(event.from_piece, sizeof(event.from_piece), "%s", piece_lookup[WP]);
                snprintf(event.to_piece, sizeof(event.to_piece), "%s", piece_lookup[WZ]);
                ua_event_buffer_push(events, &event);
            }
        }
        
        // remove promoted peons from WP
        board->pieces[WP] &= ~white_promotions;
        
        // add promoted peons to WZ
        board->pieces[WZ] |= white_promotions; 

    } else {
        
        // mask row 0 and take bitwise AND of bP
        Bitboard black_promotions = board->pieces[BP] & 0xFFULL;

        if (events != NULL) {
            for (Bitboard promoted = black_promotions; promoted; promoted &= (promoted - 1)) {
                int square = __builtin_ctzll(promoted);
                UAEvent event;
                memset(&event, 0, sizeof(event));
                event.type = UA_EVENT_PROMOTION;
                event.square = square;
                snprintf(event.from_piece, sizeof(event.from_piece), "%s", piece_lookup[BP]);
                snprintf(event.to_piece, sizeof(event.to_piece), "%s", piece_lookup[BZ]);
                ua_event_buffer_push(events, &event);
            }
        }
        
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
static void ua_handle_contagion_with_events(Chezzboard *board, UAEventBuffer *events) {

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

    if (events != NULL) {
        int to_zombie_type = (board->header.turn == WHITE) ? WZ : BZ;
        Bitboard infected = contagion_mask;
        while (infected) {
            int square = __builtin_ctzll(infected);
            infected &= (infected - 1);

            int from_type = -1;
            for (int i = 0; i < TOTAL_TYPES; i++) {
                if ((board->pieces[i] >> square) & 1ULL) {
                    from_type = i;
                    break;
                }
            }
            if (from_type == -1) {
                continue;
            }

            UAEvent event;
            memset(&event, 0, sizeof(event));
            event.type = UA_EVENT_CONTAGION;
            event.square = square;
            snprintf(event.from_piece, sizeof(event.from_piece), "%s", piece_lookup[from_type]);
            snprintf(event.to_piece, sizeof(event.to_piece), "%s", piece_lookup[to_zombie_type]);
            ua_event_buffer_push(events, &event);
        }
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
