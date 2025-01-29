"use strict";

(function() {
    var root = this;

    const isNodeJS = (typeof process !== 'undefined') && (process.release.name === 'node');

    function Defer() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    /**
     * Simple object for loading and decoding PCX files
     * 
     * @param {Buffer|ArrayBuffer} buffer to decoded PCX data from
     * 
     */
    function PCX(buffer) {
        this.buffer = buffer;
        this.byteView = new Uint8Array(buffer);
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

        this.readHeader();
    }

    PCX.prototype = {
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
                    palette: isNodeJS ? new Uint8Array(this.buffer.buffer, 16, 48) : new Uint8Array(this.buffer, 16, 48),
                    bitplanes: this.byteView[65],
                    bpr: this._readLEWord(66)
                });

                this.width = this.header.xmax - this.header.xmin + 1;
                this.height = this.header.ymax - this.header.ymin + 1;
                this.planes = this.header.bitplanes;

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
         * Sets the palette either from the header (< 8 bit) or at the bottom of the file (8bit)
         * 
         * Note: in Node.js, this.palette is a copy of the palette data from the buffer
         * so modifying the palette won't impact the main buffer.
         * 
         * When ran in the browser, palette buffer is shared with the main buffer.
         */
        getPalette: function() {
            // check that we have a 256 colors palette at the end of the file
            if (this.header.bpp === 8 && this.byteView[this.buffer.byteLength - 769] === 12) {
                this.palette = new Uint8Array(this.buffer.slice(this.buffer.byteLength - 768));
            } else if (this.header.bpp === 1) {
                this.palette = this.header.palette;
            } else {
                throw 'Could not find 256 color palette.';
            }
        },

        /**
         * Set a color using palette index
         * 
         * @param {Number} pos Pixel position to set.
         * @param {Number} index Palette index to get the color from.
         */
        setColorFromPalette: function(pos, index) {
            const palette = this.palette,
                  start = index * 3;

           let pixels = this.pixels;

            pixels[pos] = palette[start];
            pixels[pos + 1] = palette[start + 1];
            pixels[pos + 2] = palette[start + 2];
            // alpha channel
            pixels[pos + 3] = 255;
        },

        /**
         * Decodes the file
         * 
         * @param {Number} pos Pixel position to set.
         * @param {Number} index Palette index to get the color from.
         * 
         * @returns {Object} An object with the following properties:
         *  - {Unit8ArrayBuffer] pixelArray The decoded pixels, in RGBA format
         *  - {Uint8Array} palette The palette, as rgb triples
         *  - {Number} width The picture width
         *  - {Number} height The picture height
         *  - {Object} header The decoded header of the file
         * 
         */
        decode: function() {
            switch(this.header.bpp) {
                case 8:
                    this.decode8bpp();
                    break;

                case 1:
                    this.decode4bpp();
                    break;

                default:
                    throw `Unsupported bpp: ${this.header.bpp}`;
            }

            return {
                pixelArray: this.pixels,
                palette: this.palette,
                width: this.width,
                height: this.height,
                header: this.header
            };
        },

        /**
         * Decodes 4bpp pixel data
         */
        decode4bpp: function() {
            var offset = 128,
                p = 0,
                pos = 0,
                length = 0,
                val = 0;

            this.getPalette();

            // temp buffer that will hold 
            this.temp = new Uint8Array(new ArrayBuffer(this.width * this.height));
            this.pixels = new Uint8Array(new ArrayBuffer(this.width * this.height * 4));

            // ctx.createImageData(this.width, this.height);

            for (p = 0; p < this.temp.byteLength; p++) {
                this.temp[p] = 0;
            }

            /**
             * Simple RLE decoding: if 2 msb == 1 then we have to mask out count
             * and repeat following byte count times
             */
            for (var y = 0; y < this.height; y++ ){
                for (p = 0; p < this.planes; p++) {
                    /* bpr holds the number of bytes needed to decode a row of plane:
                    we keep on decoding until the buffer is full
                    */
                    pos = this.width * y;
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
                        if ( (byte * 8) < this.width) {
                            // this.setColorFromPalette(pos, val);
                            for (var i = 0; i < 8; i++) {
                                var bit = ((val >> (7-i)) & 1);
                                this.temp[pos + i] |= bit << p;

                                // we have all planes: we may set color using the palette
                                if (p === this.planes - 1) {
                                    this.setColorFromPalette((pos + i) * 4, this.temp[pos + i]);
                                }
                            }
        
                            pos += 8;
                        }
                    }
                }
            }
        },

        /**
         * Decodes 8bpp (depth = 8/24bit) data
         */
        decode8bpp: function(ctx) {
            if (this.planes === 1) {
                this.getPalette();
            }

            // prepare pixel buffer
            // this.pcx_pixels = new Uint8Array(new ArrayBuffer(this.width * this.height * 4));
            // this.pixels = ctx.createImageData(this.width, this.height);
            this.pixels = new Uint8Array(new ArrayBuffer(this.width * this.height * 4));

            // PCX header is 128 bytes long
            var offset = 128,
                p = 0,
                pos = 0,
                length = 0,
                val = 0;

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
                            if (this.planes === 3) {
                                this.pixels[pos] = val;
                                // add alpha channel
                                if (p === this.planes - 1) {
                                    this.pixels[pos + 1] = 255;
                                }
                            } else {
                                this.setColorFromPalette(pos, val);
                            }
        
                            pos += 4;
                        }
                    }
                }
            }
        }
    };

    if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
        module.exports = PCX;
    } else {
        if (typeof define === 'function' && define.amd) {
            define([], function() {
                return PCX;
            });
        } else {
            window.PCX = PCX;
        }
    }
})(this);
