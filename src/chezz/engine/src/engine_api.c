#include "chezz.h"
#include "manage_search.h"

#ifdef _WIN32
#define ENGINE_EXPORT __declspec(dllexport)
#else
#define ENGINE_EXPORT
#endif

static void reset_board(Chezzboard *board) {
    memset(board, 0, sizeof(Chezzboard));
}

void load_board_from_string(Chezzboard *board, const char *input) {
    if (!board || !input) {
        return;
    }
    reset_board(board);

    size_t len = strlen(input);
    char *buf = (char *)malloc(len + 1);
    if (!buf) {
        return;
    }
    memcpy(buf, input, len + 1);

    char *line = strtok(buf, "\n");
    if (!line) {
        free(buf);
        return;
    }

    char turn = 'w';
    int time_taken = 0;
    int max_time = 60000;
    int num_moves = 0;
    if (sscanf(line, " %c %d %d %d", &turn, &time_taken, &max_time, &num_moves) == 4) {
        board->header.turn = (turn == 'b' || turn == 'B') ? BLACK : WHITE;
        board->header.time_taken = time_taken;
        board->header.max_time = max_time;
        board->header.num_moves = num_moves;
    }

    // skip lines until the opening '{' of the piece map
    bool in_board = false;
    while ((line = strtok(NULL, "\n")) != NULL) {
        if (!in_board) {
            if (strchr(line, '{')) {
                in_board = true;
            }
            continue;
        }
        if (strchr(line, '}')) {
            break;
        }

        char square[3] = {0};
        char piece[3] = {0};
        if (sscanf(line, " %2[^:]: '%2[^']'", square, piece) == 2) {
            int bit_index = square_to_index(square);
            int piece_index = get_piece_index(piece);
            if (piece_index >= 0 && bit_index >= 0 && bit_index < 64) {
                Bitboard bit = (1ULL << bit_index);
                board->pieces[piece_index] |= bit;
                if (piece[0] == WHITE) {
                    board->white_pieces |= bit;
                } else if (piece[0] == BLACK) {
                    board->black_pieces |= bit;
                }
                board->all_pieces |= bit;
            }
        }
    }

    free(buf);
}

static int to_string_buf(Chezzboard *board, char *out, size_t out_size) {
    if (!board || !out || out_size == 0) {
        return -1;
    }

    char tmp[2048];
    tmp[0] = '\0';
    char row_buf[128];
    int last_comma_pos = -1;

    snprintf(
        tmp,
        sizeof(tmp),
        "%c %d %d %d\n{\n",
        board->header.turn,
        board->header.time_taken,
        board->header.max_time,
        board->header.num_moves
    );

    for (char c = 'a'; c <= 'h'; c++) {
        for (char r = '1'; r <= '8'; r++) {
            char square_str[3] = {c, r, '\0'};
            int square = square_to_index(square_str);
            for (int i = 0; i < TOTAL_TYPES; i++) {
                if ((board->pieces[i] >> square) & 1ULL) {
                    snprintf(row_buf, sizeof(row_buf), "  %s: '%s',\n", square_str, piece_lookup[i]);
                    strncat(tmp, row_buf, sizeof(tmp) - strlen(tmp) - 1);
                    last_comma_pos = (int)strlen(tmp) - 2;
                }
            }
        }
    }

    if (last_comma_pos >= 0) {
        tmp[last_comma_pos] = '\n';
        tmp[last_comma_pos + 1] = '\0';
    }
    strncat(tmp, "}\n", sizeof(tmp) - strlen(tmp) - 1);

    size_t out_len = strlen(tmp);
    if (out_len + 1 > out_size) {
        return -1;
    }
    memcpy(out, tmp, out_len + 1);
    return 0;
}

ENGINE_EXPORT int engine_best_move(const char *input, char *output, size_t output_size) {
    Chezzboard input_board;
    load_board_from_string(&input_board, input);
    Chezzboard best_move = start_search(&input_board);
    return to_string_buf(&best_move, output, output_size);
}

