"use strict";
const swarm = require('swarm-protocol');
const sync = require('swarm-syncable');
const OpStream = sync.OpStream;

/**
 * BatchOpStream extends OpStream by adding some server-side processing features:
 * 1. batching: ops that are offered synchronously are considered one batch;
 *      any result of their processing is also emitted synchronously
 * 2. isolation: BOS acts as a call stack root; that avoids the problem of
 *      unpredictable stack traces that start in the network or in the db, then
 *      ricochet all around the place
 * 3. backpressure: once BOS receives OpStream.SLOW_DOWN, it increases pauses
 *      between batches, relays SLOW_DOWN further TODO
 *
 * BOP is not a node.js stream.
 * */
class BatchedOpStream extends OpStream {

    constructor () {
        super();
        this._ingress_batch = null;
        this._processed_batch = null;
        this._egress_batch = null;
        this._process_next_batch_cb = this._process_next_batch.bind(this);
        this._done_cb = this._done.bind(this);
        this._process_cb = this._process.bind(this, this._done_cb);
    }

    /** @override */
    offer (op) {

        if (this._debug)
            console.warn('}'+this._debug+'\t'+op.toString());

        if (this._ingress_batch===null) {
            if (this._processed_batch===null)
                process.nextTick(()=>this._process_next_batch());
            this._ingress_batch = [];
        }

        this._ingress_batch.push(op);

    }

    _batch (op) {
        this._egress_batch.push(op);
    }

    /** totally synchronous */
    _forward_batch (ops) {
        if (this._debug)
            console.warn('{'+this._debug+'\t['+ops.length+']');
        super._emitAll(ops); // emit the batch synchronously
    }

    _process_next_batch () {
        if (this._processed_batch) {
            if (this._processed_batch.length)
                throw new Error('state machine XXXXX');
            if (this._egress_batch.length)
                this._forward_batch(this._egress_batch);
            this._processed_batch = null;
            this._egress_batch = null;
        }
        if (this._ingress_batch) {
            this._processed_batch = this._ingress_batch.reverse();
            this._ingress_batch = null;
            this._egress_batch = [];
            this._process_cb();
        }
    }

    _process (done) {
        this._process_op(this._processed_batch.pop(), done); // breaks the batch
    }

    _done (err) {
        if (err) {
            console.error(err);
            this._stop();
        } else if (this._processed_batch===null) {
            console.warn(new Error('invalid callback').stack);
        } else if (this._processed_batch.length) {
            // TODO e.g. stack depth 100
            process.nextTick(this._process_cb);
        } else {
            this._process_next_batch();
            /*process.nextTick(()=>{
                if (this._processed_batch.length)
                    this._process_cb();
                else
                    this._process_next_batch();
            });*/
        }
    }

    /** The method to be overloaded by implementations. */
    _process_op (op, done) {
        this._batch(op); // by default, emit the same batch
        done();
    }

    _end () {
        this._ingress_batch = null;
        super._end();
    }

}

module.exports = BatchedOpStream;
