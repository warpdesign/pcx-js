function Defer() {
    this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}

/**
 * Simple object for loading and decoding PCX files
 * 
 * @param {File} file A reference to the file to load.
 * 
 */
function PCX(file) {
    this.file = file;
    this.buffer = null;
    this.header = {
        version: 0,
        bpp: 0,
        xmin: 0,
        xmax: 0,
        ymin: 0,
        ymax: 0,
        hdpi: 0,
        vdpi: 0,
        palette: null,
        bitplanes: 0
    };
    this.pixels = null;
}

PCX.prototype = {
    /**
     * Loads the file into an `ArrayBuffer` so that it's
     * ready to be decoded
     * 
     * @returns {Defer} A promise
     */
    loadFile: function() {
        console.log('Loading file');
        var def = new Defer();

        var reader = new FileReader();
        
        reader.onload = (e) => {
            console.log(`File loaded, length = ${e.target.result.byteLength} bytes`);
            this.buffer = e.target.result;
            this.byteView = new Uint8Array(e.target.result);
            def.resolve(this.buffer);
        }

        reader.readAsArrayBuffer(this.file);

        return def.promise;
    },

    /**
     * Reads a little-endian word from the buffer
     * 
     * @param {Number} offset The offset. Doesn't need to be word-aligned.
     * 
     * @returns {Number} The word.
     * 
     * @private
     */
    _readLEWord: function(offset) {
        return this.byteView[offset] | this.byteView[offset + 1] << 8;
    },

    /**
     * Returns true if the PCX 10 marker was found at offset 0.
     * 
     * @returns {Boolean}
     */
    isPCXFile: function() {
        return this.byteView && this.byteView[0] === 10;
    },

    /**
     * Retrieves data from the PCX header and keep it in this.header.
     * The width & height are also saved into this.width & this.height.
     */
    readHeader: function() {
        console.log('Reading header');
        var def = new Defer();

        if (!this.isPCXFile()) {
            def.reject("Not a PCX File");
        } else {
            this.header = Object.assign(this.header, {
                version: this.byteView[1],
                encoding: this.byteView[2],                
                bpp: this.byteView[3],
                xmin: this._readLEWord(4),
                ymin: this._readLEWord(6),
                xmax: this._readLEWord(8),
                ymax: this._readLEWord(10),
                hdpi: this._readLEWord(12),
                vdpi: this._readLEWord(14),
                palette: new Uint8Array(this.buffer, 16, 48),
                bitplanes: this.byteView[65],
                bpr: this._readLEWord(66)
            });

            this.width = this.header.xmax - this.header.xmin + 1;
            this.height = this.header.ymax - this.header.ymin + 1;
            this.planes = this.header.bitplanes;

            console.log('Read header', this.header);

            def.resolve(this.header);
        }

        return def.promise;
    },

    /**
     * Returns true if the 2 most-significant bits are set
     * 
     * @param {Number} offset The byte offset to check.
     * 
     * @returns {Boolean} True if the 2 MSB are set
     * 
     * @private
     */
    _isRLE: function(offset) {
        var rle = this.byteView[offset] >> 6;

        return rle === 3;
    },

    /**
     * Returns the length of the RLE run.
     * 
     * @param {Number} offset The byte to get the run length from.
     * 
     * @returns {Number} The run length (<= 63).
     * 
     * @private
     */
    _lengthRLE: function(offset) {
        return this.byteView[offset] & 63;
    },

    /**
     * Decode RLE-Encoded PCX file into HTML Canvas format
     */
    decode: function(ctx) {
        console.log('Decoding PCX pixel data');
        // prepare pixel buffer
        // this.pcx_pixels = new Uint8Array(new ArrayBuffer(this.width * this.height * 4));
        this.pixels = ctx.createImageData(this.width, this.height);

        // PCX header is 128 bytes long
        var offset = 128,
            p = 0,
            pos = 0,
            length = 0;

        /**
         * Simple RLE decoding: if 2 msb == 1 then we have to mask out count
         * and repeat following byte count times
         */
        for (var y = 0; y < this.height; y++ ){
            for (p = 0; p < this.planes; p++) {
                /* bpr holds the number of bytes needed to decode a row of plane:
                   we keep on decoding until the buffer is full
                */
                pos = 4 * this.width * y + p;
                for (var byte = 0; byte < this.header.bpr; byte++) {
                    if (length === 0) {
                        if (this._isRLE(offset)) {
                            length = this._lengthRLE(offset);
                            val = this.byteView[offset + 1];
                            offset += 2
                        } else {
                            length = 1;
                            val = this.byteView[offset++];
                        }
                    }
                    length--;

                    /* Since there may, or may not be blank data at the end of each
                       scanline, we simply check we're not out of bounds
                    */
                    if (byte < this.width) {
                        this.pixels.data[pos] = val;
                        // add alpha channel
                        if (p === 2) {
                            this.pixels.data[pos + 1] = 255;
                        }
                        pos += 4;
                    }
                }
            }
        }
    },

    /**
     * Renders decoded and converted pixel data onto the specified canvas context.
     * 
     * @param {CanvasContext} ctx The context to render the pixels on.
     */
    render: function(ctx) {
        console.log('Drawing pixel data');

        // resize canvas
        ctx.canvas.width = this.width;
        ctx.canvas.height = this.height;
        ctx.putImageData(this.pixels, 0, 0);
    }
};