#include "chezz.h"
#include "manage_search.h"
#include <pthread.h>

const char *square_lookup[TOTAL_SQUARES] = {
    "A1", "B1", "C1", "D1", "E1", "F1", "G1", "H1",
    "A2", "B2", "C2", "D2", "E2", "F2", "G2", "H2",
    "A3", "B3", "C3", "D3", "E3", "F3", "G3", "H3",
    "A4", "B4", "C4", "D4", "E4", "F4", "G4", "H4",
    "A5", "B5", "C5", "D5", "E5", "F5", "G5", "H5",
    "A6", "B6", "C6", "D6", "E6", "F6", "G6", "H6",
    "A7", "B7", "C7", "D7", "E7", "F7", "G7", "H7",
    "A8", "B8", "C8", "D8", "E8", "F8", "G8", "H8"
};

const Bitboard col_masks[8] = {
    0x0101010101010101ULL,
    0x0202020202020202ULL,
    0x0404040404040404ULL,
    0x0808080808080808ULL,
    0x1010101010101010ULL,
    0x2020202020202020ULL,
    0x4040404040404040ULL,
    0x8080808080808080ULL
};

const Bitboard row_masks[8] = {
    0x00000000000000FFULL,
    0x000000000000FF00ULL,
    0x0000000000FF0000ULL,
    0x00000000FF000000ULL,
    0x000000FF00000000ULL,
    0x0000FF0000000000ULL,
    0x00FF000000000000ULL,
    0xFF00000000000000ULL
};

const char *piece_lookup[TOTAL_TYPES] = {
    "wP", "bP",
    "wN", "bN",
    "wB", "bB",
    "wR", "bR",
    "wQ", "bQ",
    "wK", "bK",
    "wZ", "bZ",
    "wF", "bF",
    "wC", "bC"
};


/*
 * Converts square notation to bitboard index.
 * square: Str in algebraic notation (ex: "e8").
 * Returns int index (0-63) for the bitboard.
 */
int square_to_index(const char *square) {
    int column = square[0] - 'a';  // convert 'a'-'h' to 0-7
    int row = (square[1] - '1');
    return row * 8 + column; // compute bitboard index
}


/*
 * Gets the piece index using a lookup table.
 * piece: Str representation of the piece (ex: "wP").
 * Returns int index into pieces array, or INVALID_PIECE if not found.
 */
int get_piece_index(const char *piece) {
    for (int i = 0; i < TOTAL_TYPES; i++) {
        if (strcmp(piece, piece_lookup[i]) == 0) {
            return i;  // Return matched enum index
        }
    }
    return INVALID_PIECE; // Not found
}


/*
 * Loads a board from a file, initializing bitboards.
 * board: Ptr to Chezzboard to populate.
 * filename: Path to the file containing board data.
 * Returns nothing.
 */
void load_board_from_file(Chezzboard *board, const char *filename) {
    
    /* 1. Open file and read header */
    FILE *fp = fopen(filename, "r"); // open file for reading

    // error opening file
    if (!fp) {
        printf("Error: Cannot open file %s\n", filename);
        return;
    }

    // Read the header (turn, time_taken, max_time, num_moves)
    fscanf(fp, " %c %d %d %d", &board->header.turn, &board->header.time_taken, 
           &board->header.max_time, &board->header.num_moves);
    

    /* 2. Skip to board data */
    char line[256];
    
    // scan until we find '{' marking board start
    while (fgets(line, sizeof(line), fp)) {
        if (strchr(line, '{')) break;
    }


    /* 3. Read piece positions */
    // read piece positions inside curly brackets until `}`
    while (fgets(line, sizeof(line), fp)) {
        if (strchr(line, '}')) break; // stop reading

        char square[3], piece[3];
        
        // scan the line
        if (sscanf(line, " %2[^:]: '%2[^']", square, piece) == 2) {
            
            // convert square notation (e.g., "e8") to bitboard index
            int bit_index = square_to_index(square);

            // convert piece notation to bitboard array index
            int piece_index = get_piece_index(piece);

            // if valid piece, set the bit in its bitboard
            if (piece_index >= 0) {
                // create a bit mask with a 1 at bit_index
                board->pieces[piece_index] |= (1ULL << bit_index);

                // update white_pieces or black_pieces
                if (piece[0] == WHITE) {
                    board->white_pieces |= (1ULL << bit_index);
                } else if (piece[0] == BLACK) {
                    board->black_pieces |= (1ULL << bit_index);
                }

            } else {
                printf("Error: Invalid Piece %s\n", piece);
            }
        }
    }

    /* 4. Finalize board */
    fclose(fp); // close file

    // update all_pieces after loading all pieces
    board->all_pieces = board->white_pieces | board->black_pieces;
}

// helper to read from stdin
void load_board_from_stdin(Chezzboard *board) {
    
    /* 1. Read header from standard input */
    
    // Read the header (turn, time_taken, max_time, num_moves)
    fscanf(stdin, " %c %d %d %d", 
           &board->header.turn, 
           &board->header.time_taken, 
           &board->header.max_time, 
           &board->header.num_moves);
    
    /* 2. Skip to board data */
    char line[256];
    
    // Read lines from stdin until we find '{' marking the board start.
    while (fgets(line, sizeof(line), stdin)) {
        if (strchr(line, '{')) break;
    }
    
    /* 3. Read piece positions */
    // read piece positions inside curly brackets until `}`
    while (fgets(line, sizeof(line), stdin)) {
        if (strchr(line, '}')) break; // stop reading

        char square[3], piece[3];
        
        // scan the line
        if (sscanf(line, " %2[^:]: '%2[^']", square, piece) == 2) {
            
            // convert square notation (e.g., "e8") to bitboard index
            int bit_index = square_to_index(square);

            // convert piece notation to bitboard array index
            int piece_index = get_piece_index(piece);

            // if valid piece, set the bit in its bitboard
            if (piece_index >= 0) {
                // create a bit mask with a 1 at bit_index
                board->pieces[piece_index] |= (1ULL << bit_index);

                // update white_pieces or black_pieces
                if (piece[0] == WHITE) {
                    board->white_pieces |= (1ULL << bit_index);
                } else if (piece[0] == BLACK) {
                    board->black_pieces |= (1ULL << bit_index);
                }

            } else {
                printf("Error: Invalid Piece %s\n", piece);
            }
        }
    }

    /* 4. Finalize board */

    // update all_pieces after loading all pieces
    board->all_pieces = board->white_pieces | board->black_pieces;
}

/*
 * Loads a board from a C string (in-memory equivalent of load_board_from_file).
 * board: Ptr to Chezzboard to populate.
 * input: Null-terminated string in the same wire format as the file/stdin readers.
 * Returns nothing.
 *
 * Used by engine_best_move() so the function-call API can parse its input without
 * touching stdin, making concurrent in-process calls safe.
 */
void load_board_from_string(Chezzboard *board, const char *input) {

    /* 1. Copy input into a mutable buffer for fmemopen */
    size_t len = strlen(input);
    char *buf = (char *)malloc(len + 1);
    if (!buf) return;
    memcpy(buf, input, len + 1);

    FILE *fp = fmemopen(buf, len, "r");
    if (!fp) { free(buf); return; }

    /* 2. Read header (turn, time_taken, max_time, num_moves) */
    fscanf(fp, " %c %d %d %d",
           &board->header.turn,
           &board->header.time_taken,
           &board->header.max_time,
           &board->header.num_moves);

    /* 3. Skip to board body '{' */
    char line[256];
    while (fgets(line, sizeof(line), fp)) {
        if (strchr(line, '{')) break;
    }

    /* 4. Read piece positions until '}' */
    while (fgets(line, sizeof(line), fp)) {
        if (strchr(line, '}')) break;

        char square[3], piece[3];
        if (sscanf(line, " %2[^:]: '%2[^']", square, piece) == 2) {
            int bit_index  = square_to_index(square);
            int piece_index = get_piece_index(piece);
            if (piece_index >= 0) {
                board->pieces[piece_index] |= (1ULL << bit_index);
                if (piece[0] == WHITE)
                    board->white_pieces |= (1ULL << bit_index);
                else if (piece[0] == BLACK)
                    board->black_pieces |= (1ULL << bit_index);
            }
        }
    }

    /* 5. Finalize board */
    board->all_pieces = board->white_pieces | board->black_pieces;
    fclose(fp);
    free(buf);
}


/*
 * Converts the bitboard to a string representation.
 * board: Ptr to the Chezzboard to convert.
 * Returns ptr to a static str with the board layout.
 */
char *to_string(Chezzboard *board) {

    /* 1. Initialize buffers and header */
    static char result[2048]; // buffer to store result
    char buffer[128]; // temp buffer for formatting

    int last_comma_pos = -1; // track pos of last comma

    // set header
    snprintf(result, sizeof(result), "%c %d %d %d\n{\n", 
             board->header.turn, 
             board->header.time_taken, 
             board->header.max_time, 
             board->header.num_moves);


    /* 2. Build piece positions */
    // iterate over columns ('a' to 'h')
    for (char c = 'a'; c <= 'h'; c++) {

        // iterate over row
        for (char r = '1'; r <= '8'; r++) {

            // compute bitboard index using square_to_index()
            char square_str[3] = { c, r, '\0' };
            int square = square_to_index(square_str);

            // iterate over each piece type
            for (int i = 0; i < TOTAL_TYPES; i++) {
                
                // check if piece is at this square
                if ((board->pieces[i] >> square) & 1) {

                    // append piece pos to result
                    snprintf(buffer, sizeof(buffer), "  %s: '%s',\n", square_str, piece_lookup[i]);
                    strncat(result, buffer, sizeof(result) - strlen(result) - 1);

                    // update last comma position
                    last_comma_pos = strlen(result) - 2;
                }
            }
        }
    }

    /* 3. Finalize string */
    // remove last comma before returning str
    if (last_comma_pos >= 0) {
        result[last_comma_pos] = '\n';
        result[last_comma_pos + 1] = '\0';
    }

    // append closing brace
    strncat(result, "}\n", sizeof(result) - strlen(result) - 1);

    return result;
}



static int to_string_buf(Chezzboard *board, char *out, size_t out_size) {

    /* 1. Initialize buffers and header */
    char tmp[2048];
    char buf[128];
    int last_comma_pos = -1;

    // set header
    snprintf(tmp, sizeof(tmp), "%c %d %d %d\n{\n",
             board->header.turn,
             board->header.time_taken,
             board->header.max_time,
             board->header.num_moves);


    /* 2. Build piece positions */
    // iterate over columns ('a' to 'h')
    for (char c = 'a'; c <= 'h'; c++) {

        // iterate over rows
        for (char r = '1'; r <= '8'; r++) {

            // compute bitboard index using square_to_index()
            char square_str[3] = { c, r, '\0' };
            int square = square_to_index(square_str);

            // iterate over each piece type
            for (int i = 0; i < TOTAL_TYPES; i++) {

                // check if piece is at this square
                if ((board->pieces[i] >> square) & 1) {

                    // append piece pos to result
                    snprintf(buf, sizeof(buf), "  %s: '%s',\n", square_str, piece_lookup[i]);
                    strncat(tmp, buf, sizeof(tmp) - strlen(tmp) - 1);

                    // update last comma position
                    last_comma_pos = (int)strlen(tmp) - 2;
                }
            }
        }
    }


    /* 3. Finalize and copy to caller buffer */
    // remove last comma before copying
    if (last_comma_pos >= 0) {
        tmp[last_comma_pos] = '\n';
        tmp[last_comma_pos + 1] = '\0';
    }

    // append closing brace
    strncat(tmp, "}\n", sizeof(tmp) - strlen(tmp) - 1);

    // copy into caller's buffer; return -1 if too small
    size_t len = strlen(tmp);
    if (len + 1 > out_size) return -1;
    memcpy(out, tmp, len + 1);
    return 0;
}


/*
 * Function-call API: compute the best move from an in-memory input string.
 * input: Null-terminated board string in the standard wire format.
 * output: Caller-provided buffer that receives the result string.
 * output_size: Size of the output buffer in bytes.
 * Returns 0 on success; -1 if the output buffer is too small.
 *
 * Preferred over the stdin/stdout path when multiple games run in the same
 * process: each call is self-contained (no I/O), and the search path is
 * re-entrant for concurrent in-process calls.
 */
int engine_best_move(const char *input, char *output, size_t output_size) {

    /* 1. Parse input into a board (no stdin needed) */
    Chezzboard input_board;
    memset(&input_board, 0, sizeof(Chezzboard));
    load_board_from_string(&input_board, input);

    /* 2. Run search — now fully re-entrant, no outer mutex */
    Chezzboard best_move = start_search(&input_board);

    /* 3. Serialise result into caller's buffer and return */
    return to_string_buf(&best_move, output, output_size);
}


/*
 * Main function for the Chezz program.
 * argc: Num command-line args.
 * argv: Array of command-line arg strings.
 * Returns int status code (0 for success, 1 for error).
 */
int main(void) {

    /* 1. Read all of stdin into a buffer */
    char in_buf[4096] = {0};
    size_t total = 0;
    int ch;
    while ((ch = getchar()) != EOF && total + 1 < sizeof(in_buf)) {
        in_buf[total++] = (char)ch;
    }
    in_buf[total] = '\0';

    /* 2. Run search via function-call API and print result */
    char out_buf[2048] = {0};
    int rc = engine_best_move(in_buf, out_buf, sizeof(out_buf));
    if (rc == 0) {
        printf("%s", out_buf);
    }

    return rc;
}

