#include "phylib.h"


/* Part 1: Create & malloc new objects. */

/*
 * Allocate and initialise a new phylib_object representing a still ball.
 * number: The ball number.
 * pos: Ptr to a 2D vector (the ball's position).
 * Returns phylib_object* Ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_still_ball(unsigned char number, phylib_coord *pos) {
    // malloc
    phylib_object *new_still_ball = (phylib_object *)malloc(sizeof(phylib_object));

    // check if success
    if (new_still_ball != NULL) {

        // set obj type
        new_still_ball->type = PHYLIB_STILL_BALL;

        // set obj data
        new_still_ball->obj.still_ball.number = number;
        new_still_ball->obj.still_ball.pos = *pos;
    }

    // return ptr to new obj
    return new_still_ball;
}


/*
 * Allocate and initialise a new phylib_object representing a rolling ball.
 * number: The ball number.
 * pos: Ptr to the 2D vector (ball's position).
 * vel: Ptr to the 2D vector (ball's velocity).
 * acc: Ptr to the 2D vector (ball's acceleration).
 * Returns phylib_object* Ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_rolling_ball(unsigned char number, phylib_coord *pos,
                                       phylib_coord *vel, phylib_coord *acc) {
    // malloc
    phylib_object *new_rolling_ball = (phylib_object *)malloc(sizeof(phylib_object));

    // check if success
    if (new_rolling_ball != NULL) {

        // set obj type
        new_rolling_ball->type = PHYLIB_ROLLING_BALL;

        // set obj data
        new_rolling_ball->obj.rolling_ball.number = number;
        new_rolling_ball->obj.rolling_ball.pos = *pos;
        new_rolling_ball->obj.rolling_ball.vel = *vel;
        new_rolling_ball->obj.rolling_ball.acc = *acc;
    }

    // return ptr to new obj
    return new_rolling_ball;
}


/*
 * Allocate and initialise a new phylib_object representing a pocket hole.
 * pos: Ptr to the 2D vector representing the hole's position.
 * Returns phylib_object* Ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_hole(phylib_coord *pos) {

    // malloc
    phylib_object *new_hole = (phylib_object *)malloc(sizeof(phylib_object));

    // check if success
    if (new_hole != NULL) {

        // set obj type
        new_hole->type = PHYLIB_HOLE;

        // set obj data
        new_hole->obj.hole.pos = *pos;
    }

    // return ptr to new obj
    return new_hole;
}


/*
 * Allocate and initialise a new phylib_object representing a horizontal cushion.
 * y: Y-coordinate of the cushion.
 * Returns phylib_object* Ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_hcushion(double y) {

    // malloc
    phylib_object *new_hcushion = (phylib_object *)malloc(sizeof(phylib_object));

    // check if success
    if (new_hcushion != NULL) {

        // set obj type
        new_hcushion->type = PHYLIB_HCUSHION;

        // set obj data
        new_hcushion->obj.hcushion.y = y;
    }

    // return ptr to new obj
    return new_hcushion;
}


/*
 * Allocate and initialise a new phylib_object representing a vertical cushion.
 * x: X-coordinate of the cushion.
 * Returns phylib_object* Ptr to the allocated object, or NULL if malloc fails.
 */
phylib_object *phylib_new_vcushion(double x) {
    // malloc
    phylib_object *new_vcushion = (phylib_object *)malloc(sizeof(phylib_object));

    // check if success
    if (new_vcushion != NULL) {

        // set obj type
        new_vcushion->type = PHYLIB_VCUSHION;

        // set obj data
        new_vcushion->obj.vcushion.x = x;
    }

    // return ptr to new obj
    return new_vcushion;
}


/*
 * Allocate and initialise a new phylib_table with cushions and holes in standard positions.
 * Returns phylib_table* Ptr to the allocated table, or NULL if malloc fails.
 */
phylib_table *phylib_new_table(void) {
    // malloc
    phylib_table *new_table = (phylib_table *)malloc(sizeof(phylib_table));

    // check if success
    if (new_table != NULL) {

        // set the time
        new_table->time = 0.0;

        // assign values to array using phylib_new_*
        new_table->object[0] = phylib_new_hcushion(0.0);
        new_table->object[1] = phylib_new_hcushion(PHYLIB_TABLE_LENGTH);
        new_table->object[2] = phylib_new_vcushion(0.0);
        new_table->object[3] = phylib_new_vcushion(PHYLIB_TABLE_WIDTH);

        // create 6 holes: 4 corners & 2 midway
        new_table->object[4] = phylib_new_hole(&(phylib_coord){0.0, 0.0}); // top left
        new_table->object[5] = phylib_new_hole(&(phylib_coord){0.0, PHYLIB_TABLE_LENGTH / 2.0}); // left midway
        new_table->object[6] = phylib_new_hole(&(phylib_coord){0.0, PHYLIB_TABLE_LENGTH}); // bottom left
        new_table->object[7] = phylib_new_hole(&(phylib_coord){PHYLIB_TABLE_WIDTH, 0.0}); // top right
        new_table->object[8] = phylib_new_hole(&(phylib_coord){PHYLIB_TABLE_WIDTH, PHYLIB_TABLE_LENGTH / 2.0}); // right midway
        new_table->object[9] = phylib_new_hole(&(phylib_coord){PHYLIB_TABLE_WIDTH, PHYLIB_TABLE_LENGTH}); // bottom right

        // set remaining ptrs to NULL
        for (int i = 10; i < PHYLIB_MAX_OBJECTS; i++) {
            new_table->object[i] = NULL;
        }
    }

    // return ptr to newly created phylib_table
    return new_table;
}



/* Part 2: Utility functions */

/*
 * Copy a phylib_object from src into dest (deep copy via malloc).
 * dest: Ptr-to-ptr where the address of the copied object will be stored.
 * src: Ptr-to-ptr pointing to the source object.
 * Nothing.
 */
void phylib_copy_object(phylib_object **dest, phylib_object **src) {

    if (*src == NULL) {
        *dest = NULL; // assign NULL to dest 2nd ptr
        return;
    }

    // malloc
    *dest = (phylib_object *)malloc(sizeof(phylib_object));

    // check failure
    if (dest == NULL) {
        return;
    }

    // copy contents of object from src to dest
    memcpy(*dest, *src, sizeof(phylib_object));
}


/*
 * Deep-copy a phylib_table to a new memory location.
 * table: Ptr to the source table.
 * Returns phylib_table* Ptr to the newly allocated copy, or NULL if malloc fails.
 */
phylib_table *phylib_copy_table(phylib_table *table) {

    if (table == NULL) {
        return NULL;
    }

    // malloc
    phylib_table *new_table = (phylib_table *)malloc(sizeof(phylib_table));

    // check if failure
    if (new_table == NULL) {
        return NULL;
    }

    // copy contents of table to new mem-location
    for (int i = 0; i < PHYLIB_MAX_OBJECTS; i++) {
        phylib_copy_object(&(new_table->object[i]), &(table->object[i]));
    }

    // copy time
    new_table->time = table->time;

    return new_table;
}


/*
 * Add a phylib_object to the first NULL slot in a phylib_table.
 * table: Ptr to the target table.
 * object: Ptr to the object to add.
 * Nothing.
 */
void phylib_add_object(phylib_table *table, phylib_object *object) {

    if (table == NULL || object == NULL) {
        return;
    }

    // iterate over objects in array
    for (int i = 0; i < PHYLIB_MAX_OBJECTS; i++) {

        // check for NULL ptrs
        if (table->object[i] == NULL) {

            // make ptr the address of obj
            table->object[i] = object;

            return;
        }
    }
}


/*
 * Free all objects and the table itself.
 * table: Ptr to the table to free.
 * Nothing.
 */
void phylib_free_table(phylib_table *table) {

    if (table == NULL) {
        return;
    }

    // iterate over objects & free all non-NULL ptrs
    for (int i = 0; i < PHYLIB_MAX_OBJECTS; i++) {

        if (table->object[i] != NULL) {

            free(table->object[i]);

            table->object[i] = NULL; // set ptr to NULL for safety
        }
    }

    // free table mem
    free(table);
}


/*
 * Compute the vector difference between two phylib_coord values (c1 - c2).
 * c1: The first vector.
 * c2: The second vector.
 * Returns phylib_coord The resulting difference vector.
 */
phylib_coord phylib_sub(phylib_coord c1, phylib_coord c2) {

    // new phylib_coord for result
    phylib_coord result;

    // difference between c1 & c2
    result.x = c1.x - c2.x;
    result.y = c1.y - c2.y;

    return result;
}


/*
 * Calculate the Euclidean length of a phylib_coord vector.
 * c: The vector.
 * Returns double Length of vector c.
 */
double phylib_length(phylib_coord c) {

    // pythagorean theorem: sqrt((a^2) + (b^2))
    return sqrt((c.x * c.x) + (c.y * c.y));
}


/*
 * Compute the dot product of two phylib_coord vectors.
 * a: The first vector.
 * b: The second vector.
 * Returns double Dot product of a and b.
 */
double phylib_dot_product(phylib_coord a, phylib_coord b) {

    // dot product = (a1 * b1) + (a2 * b2)
    return ((a.x * b.x) + (a.y * b.y));
}


/*
 * Calculate distance between a rolling ball (obj1) and another object (obj2).
 * obj1: Ptr to the rolling ball object.
 * obj2: Ptr to the second object (any valid type).
 * Returns double Calculated distance, or -1.0 if obj1 is not a rolling ball or obj2 type is invalid.
 */
double phylib_distance(phylib_object *obj1, phylib_object *obj2) {

    if (obj1 == NULL || obj2 == NULL) {
        return -1.0;
    }

    // check if obj1 is PHYLIB_ROLLING_BALL
    if (obj1->type != PHYLIB_ROLLING_BALL) {
        return -1.0;
    }

    // get rolling ball position
    phylib_coord rolling_ball_pos = obj1->obj.rolling_ball.pos;

    // check the type of obj2
    switch (obj2->type) {
        case PHYLIB_STILL_BALL: {

            // get obj2 pos
            phylib_coord still_ball_pos = obj2->obj.still_ball.pos;

            // calculate dist between centers of 2 balls & subtract 2 radii
            double dist = phylib_length(phylib_sub(rolling_ball_pos, still_ball_pos)) - PHYLIB_BALL_DIAMETER;

            return dist;
        }

        case PHYLIB_ROLLING_BALL: {

            // get obj2 pos
            phylib_coord rolling_ball2_pos = obj2->obj.rolling_ball.pos;

            // calculate dist between centers of 2 balls & subtract 2 radii
            double dist = phylib_length(phylib_sub(rolling_ball_pos, rolling_ball2_pos)) - PHYLIB_BALL_DIAMETER;

            return dist;
        }

        case PHYLIB_HOLE: {

            // get obj2 pos
            phylib_coord hole_pos = obj2->obj.hole.pos;

            // calculate dist between ball center & the hole and subtract the HOLE_RADIUS
            double dist = phylib_length(phylib_sub(rolling_ball_pos, hole_pos)) - PHYLIB_HOLE_RADIUS;

            return dist;
        }

        case PHYLIB_HCUSHION: {

            // get obj2 y-coordinate
            double hcushion_y_pos = obj2->obj.hcushion.y;

            // calculate distance between the ball center & hcushion, and subtract BALL_RADIUS
            double dist = fabs(rolling_ball_pos.y - hcushion_y_pos) - PHYLIB_BALL_RADIUS;

            return dist;
        }

        case PHYLIB_VCUSHION: {

            // get obj2 x-coordinate
            double vcushion_x_pos = obj2->obj.vcushion.x;

            // calculate distance between ball center & vcushion, and subtract BALL_RADIUS
            double dist = fabs(rolling_ball_pos.x - vcushion_x_pos) - PHYLIB_BALL_RADIUS;

            return dist;
        }

        default:
            return -1.0; // obj2 invalid
    }
}



/* Part 3: Functions to simulate the balls moving on the table */

/*
 * Update position, velocity, and acceleration of a rolling ball after a given time step.
 * new: Ptr to the new phylib_object to be updated.
 * old: Ptr to the old phylib_object (state before rolling).
 * time: Duration of the time step in seconds.
 * Nothing.
 */
void phylib_roll(phylib_object *new, phylib_object *old, double time) {

    // check type
    if (new == NULL || old == NULL || new->type != PHYLIB_ROLLING_BALL || old->type != PHYLIB_ROLLING_BALL) {
        return; // do nothing
    }

    // get data
    double old_pos_x = old->obj.rolling_ball.pos.x;
    double old_pos_y = old->obj.rolling_ball.pos.y;

    double old_acc_x = old->obj.rolling_ball.acc.x;
    double old_acc_y = old->obj.rolling_ball.acc.y;

    double old_vel_x = old->obj.rolling_ball.vel.x;
    double old_vel_y = old->obj.rolling_ball.vel.y;

    // calc new pos (second integral of acc)
    new->obj.rolling_ball.pos.x = old_pos_x + (old_vel_x * time) + (0.5 * old_acc_x * (time * time));
    new->obj.rolling_ball.pos.y = old_pos_y + (old_vel_y * time) + (0.5 * old_acc_y * (time * time));

    // calc new vel
    new->obj.rolling_ball.vel.x = old_vel_x + (old_acc_x * time);
    new->obj.rolling_ball.vel.y = old_vel_y + (old_acc_y * time);

    // check for sign change in vel (reset if needed)
    // x-value
    if (old_vel_x * new->obj.rolling_ball.vel.x < 0.0) {
        // set to 0
        new->obj.rolling_ball.vel.x = 0.0;
        new->obj.rolling_ball.acc.x = 0.0;
    }
    // y-value
    if (old_vel_y * new->obj.rolling_ball.vel.y < 0.0) {
        // set to 0
        new->obj.rolling_ball.vel.y = 0.0;
        new->obj.rolling_ball.acc.y = 0.0;
    }
}


/*
 * Check whether a rolling ball has stopped and convert it to a still ball if so.
 * object: Ptr to the rolling ball phylib_object.
 * Returns unsigned char 1 if the ball was converted to a still ball, 0 if it remains rolling.
 */
unsigned char phylib_stopped(phylib_object *object) {

    // check if obj is PHYLIB_ROLLING_BALL
    if (object != NULL && object->type == PHYLIB_ROLLING_BALL) {

        // calc ball speed (len of vel)
        double ball_speed = phylib_length(object->obj.rolling_ball.vel);

        // check if ball has stopped
        if (ball_speed < PHYLIB_VEL_EPSILON) {

            // copy contents of object
            unsigned char number = object->obj.rolling_ball.number;
            double pos_x = object->obj.rolling_ball.pos.x;
            double pos_y = object->obj.rolling_ball.pos.y;

            // convert to PHYLIB_STILL_BALL
            object->type = PHYLIB_STILL_BALL;

            // copy old data to new
            object->obj.still_ball.number = number;
            object->obj.still_ball.pos.x = pos_x;
            object->obj.still_ball.pos.y = pos_y;

            return 1; // ball converted
        }
    }
    return 0; // ball still rolling
}


/*
 * Dispatch a collision event between two objects.
 * a: Double-ptr to the first phylib_object (must be a rolling ball).
 * b: Double-ptr to the second phylib_object.
 * Nothing.
 */
void phylib_bounce(phylib_object **a, phylib_object **b) {

    // check input
    if (a == NULL || b == NULL || *a == NULL || *b == NULL) {
        return; // do nothing
    }

    // check type
    if ((*a)->type != PHYLIB_ROLLING_BALL) {
        return;
    }

    // switch logic based on obj-b type
    switch ((*b)->type) {

        case PHYLIB_HCUSHION:
            handleHCushionCollision(*a);
            break;

        case PHYLIB_VCUSHION:
            handleVCushionCollision(*a);
            break;

        case PHYLIB_HOLE:
            handleHoleCollision(a);
            break;

        case PHYLIB_STILL_BALL:
            upgradeStillBallToRollingBall(*b);

        case PHYLIB_ROLLING_BALL: {
            handleRollingBallCollision(*a, *b);
            break;
        }
    }
}


/*
 * Count the number of ROLLING_BALL objects currently on the table.
 * t: Ptr to the phylib_table.
 * Returns unsigned char Total rolling balls on the table.
 */
unsigned char phylib_rolling(phylib_table *t) {

    unsigned char total_rolling_balls = 0;

    // check if table is valid
    if (t != NULL) {

        // iterate through the objects on the table
        for (int i = 0; i < PHYLIB_MAX_OBJECTS; i++) {
            phylib_object *cur_obj = t->object[i];

            // check if the object is a ROLLING_BALL
            if (cur_obj != NULL && cur_obj->type == PHYLIB_ROLLING_BALL) {
                total_rolling_balls++;
            }
        }
    }

    return total_rolling_balls;
}


/*
 * Advance simulation until the next collision or stop event and return the resulting table state.
 * table: Ptr to the current phylib_table.
 * Returns phylib_table* Ptr to the table state at the next event, or NULL if no rolling balls or table is NULL.
 */
phylib_table *phylib_segment(phylib_table *table) {

    // check for NULL and no rolling balls
    if (table == NULL) {
        return NULL;
    }

    if (phylib_rolling(table) == 0) {
        return NULL;
    }

    double time = PHYLIB_SIM_RATE; // initialise time
    int iterator = 2; // start at 2 because time starts at 1
    phylib_table *new_table = phylib_copy_table(table);

    if (new_table == NULL) {
        return NULL;
    }

    while (time < PHYLIB_MAX_TIME) {

        // loop over objects applying the phylib_roll function to each ROLLING_BALL
        for (int i = 0; i < PHYLIB_MAX_OBJECTS; i++) {

            if (new_table->object[i] != NULL) {

                if (new_table->object[i]->type == PHYLIB_ROLLING_BALL) {

                    phylib_roll(new_table->object[i], table->object[i], time);

                }
            }
        }

        // 1st loop over new_table objects
        for (int y = 0; y < PHYLIB_MAX_OBJECTS; y++) {

            // 2nd loop over new_table objects to compare
            for (int j = 0; j < PHYLIB_MAX_OBJECTS; j++) {

                if (new_table->object[y] != NULL && new_table->object[j] != NULL) {

                    if (j != y && new_table->object[y]->type == PHYLIB_ROLLING_BALL) {

                        // check the phylib_distance between the ball and another phylib_object is less than 0.0
                        if (phylib_distance(new_table->object[y], new_table->object[j]) < 0.0) {

                            // apply the phylib_bounce to the ball and the object before returning the copy of the table
                            phylib_bounce(&new_table->object[y], &new_table->object[j]);

                            new_table->time = table->time + time;

                            return new_table;
                        }
                    }
                }
            }

            // check if a ROLLING_BALL has stopped
            if (phylib_stopped(new_table->object[y])) {

                new_table->time = table->time + time;

                return new_table;
            }
        }

        time = iterator * PHYLIB_SIM_RATE;
        iterator++;
    }

    // if PHYLIB_MAX_TIME is reached in while loop
    new_table->time = table->time + time;
    return new_table;
}


/*
 * Serialise a phylib_object to a human-readable string (uses a static buffer).
 * object: Ptr to the object to serialise.
 * Returns char* Pointer to a static string describing the object.
 */
char *phylib_object_string(phylib_object *object) {
    static char string[80];
    if (object == NULL) {
        snprintf(string, 80, "NULL;");
        return string;
    }

    switch (object->type) {
        case PHYLIB_STILL_BALL:
            snprintf(string, 80, "STILL_BALL (%d,%6.1lf,%6.1lf)",
                     object->obj.still_ball.number, object->obj.still_ball.pos.x, object->obj.still_ball.pos.y);
            break;
        case PHYLIB_ROLLING_BALL:
            snprintf(string, 80, "ROLLING_BALL (%d,%6.1lf,%6.1lf,%6.1lf,%6.1lf,%6.1lf,%6.1lf)",
                     object->obj.rolling_ball.number, object->obj.rolling_ball.pos.x, object->obj.rolling_ball.pos.y,
                     object->obj.rolling_ball.vel.x, object->obj.rolling_ball.vel.y, object->obj.rolling_ball.acc.x, object->obj.rolling_ball.acc.y);
            break;
        case PHYLIB_HOLE:
            snprintf(string, 80, "HOLE (%6.1lf,%6.1lf)", object->obj.hole.pos.x, object->obj.hole.pos.y);
            break;
        case PHYLIB_HCUSHION:
            snprintf(string, 80, "HCUSHION (%6.1lf)", object->obj.hcushion.y);
            break;
        case PHYLIB_VCUSHION:
            snprintf(string, 80, "VCUSHION (%6.1lf)", object->obj.vcushion.x);
            break;
    }

    return string;
}



/* phylib_bounce helper functions */

/*
 * Handle a rolling ball colliding with a horizontal cushion (negate y velocity and acceleration).
 * ball: Ptr to the rolling ball object.
 * Nothing.
 */
void handleHCushionCollision(phylib_object *ball) {
    // negate y-vel & y-acc of ball
    ball->obj.rolling_ball.vel.y *= -1.0;
    ball->obj.rolling_ball.acc.y *= -1.0;
}


/*
 * Handle a rolling ball colliding with a vertical cushion (negate x velocity and acceleration).
 * ball: Ptr to the rolling ball object.
 * Nothing.
 */
void handleVCushionCollision(phylib_object *ball) {
    // negate x-vel & x-acc of ball
    ball->obj.rolling_ball.vel.x *= -1.0;
    ball->obj.rolling_ball.acc.x *= -1.0;
}


/*
 * Handle a rolling ball falling into a hole (free the object and set the pointer to NULL).
 * ball: Double-ptr to the rolling ball object.
 * Nothing.
 */
void handleHoleCollision(phylib_object **ball) {
    // free ball & set to NULL
    free(*ball);
    *ball = NULL;
}


/*
 * Upgrade a still ball to a rolling ball in-place, zeroing initial velocity and acceleration.
 * stillBall: Ptr to the still ball object to upgrade.
 * Nothing.
 */
void upgradeStillBallToRollingBall(phylib_object *stillBall) {

    // copy the data from old
    unsigned char number = stillBall->obj.still_ball.number;
    double pos_x = stillBall->obj.still_ball.pos.x;
    double pos_y = stillBall->obj.still_ball.pos.y;

    // upgrade STILL_BALL to ROLLING_BALL
    stillBall->type = PHYLIB_ROLLING_BALL;

    // copy old data to new
    stillBall->obj.rolling_ball.number = number;
    stillBall->obj.rolling_ball.pos.x = pos_x;
    stillBall->obj.rolling_ball.pos.y = pos_y;

    // initialise rest
    stillBall->obj.rolling_ball.vel.x = 0.0;
    stillBall->obj.rolling_ball.vel.y = 0.0;
    stillBall->obj.rolling_ball.acc.x = 0.0;
    stillBall->obj.rolling_ball.acc.y = 0.0;
}


/*
 * Resolve a collision between two rolling balls using impulse-based physics.
 * a: Ptr to the first rolling ball object.
 * b: Ptr to the second rolling ball object.
 * Nothing.
 */
void handleRollingBallCollision(phylib_object *a, phylib_object *b) {

    // calculate relative pos & vel
    phylib_coord r_ab = phylib_sub(a->obj.rolling_ball.pos, b->obj.rolling_ball.pos);
    phylib_coord v_rel = phylib_sub(a->obj.rolling_ball.vel, b->obj.rolling_ball.vel);

    // calculate normal vector
    phylib_coord n = {r_ab.x, r_ab.y};

    // get phylib_length of r_ab
    double len_r_ab = phylib_length(r_ab);

    // divide n x-coordinate & y-coordinate by len of r_ab, set result to n
    if (len_r_ab > 0.0) {
        n.x /= len_r_ab;
        n.y /= len_r_ab;
    }

    // calculate v_rel_n (dot_product of v_rel with respect to n)
    double v_rel_n = phylib_dot_product(v_rel, n);

    // update velocities for a
    a->obj.rolling_ball.vel.x -= (v_rel_n * n.x);
    a->obj.rolling_ball.vel.y -= (v_rel_n * n.y);

    // update velocities for b
    b->obj.rolling_ball.vel.x += (v_rel_n * n.x);
    b->obj.rolling_ball.vel.y += (v_rel_n * n.y);

    // compute speeds
    double speed_a = phylib_length(a->obj.rolling_ball.vel);
    double speed_b = phylib_length(b->obj.rolling_ball.vel);

    // check if greater than PHYLIB_VEL_EPSILON & add drag
    if (speed_a > PHYLIB_VEL_EPSILON) {
        a->obj.rolling_ball.acc.x = (-a->obj.rolling_ball.vel.x / speed_a) * PHYLIB_DRAG;
        a->obj.rolling_ball.acc.y = (-a->obj.rolling_ball.vel.y / speed_a) * PHYLIB_DRAG;
    }

    if (speed_b > PHYLIB_VEL_EPSILON) {
        b->obj.rolling_ball.acc.x = (-b->obj.rolling_ball.vel.x / speed_b) * PHYLIB_DRAG;
        b->obj.rolling_ball.acc.y = (-b->obj.rolling_ball.vel.y / speed_b) * PHYLIB_DRAG;
    }
}
