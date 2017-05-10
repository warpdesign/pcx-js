function Defer() {
    this.promise = new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
    });
}

Number.prototype.toHex = function(tiny) {
    var val = this.valueOf();
    var str = '';

    if (val == 0)
        str = (tiny !== undefined) ? '00' : '0000';
    else if (val > 255) {
        var upper = (val >> 8).toString(16);
        var lower = (val & 0x00FF).toString(16);
        str = ((upper.length > 1) ? upper : ('0' + upper)) + ((lower.length > 1) ? lower : ('0' + lower));
    } else {
        str = val.toString(16);
        if (val < 16)
            str = '0' + str;
    }

    if (tiny === undefined && str.length < 4)
        str = '00' + str;

    return str.toUpperCase();
}

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

    _readLEWord: function(offset) {
        return this.byteView[offset] | this.byteView[offset + 1] << 8;
    },

    isPCXFile: function() {
        return this.byteView && this.byteView[0] === 10;
    },

    readHeader: function() {
        console.log('Reading header');
        var def = new Defer();

        if (!this.isPCXFile()) {
            def.reject("Not a PCX File");
        } else {
            this.header = Object.assign(this.header, {
                version: this.byteView[1],
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

    _isRLE: function(offset) {
        var rle = this.byteView[offset] >> 6;

        return rle === 3;
    },

    _lengthRLE: function(offset) {
        return this.byteView[offset] & 63;
    },

    decode: function() {
        console.log('Decoding PCX pixel data');
        // prepare pixel buffer
        this.pcx_pixels = new Uint8Array(new ArrayBuffer(this.width * this.height * this.planes));

        // PCX header is 128 bytes long
        var offset = 128,
            complete = false,
            plane = 0,
            pos = 0,
            row = 0,
            col = 0,
            length = 0,
            isRLE = false,
            str = '';

        /**
         * Simple RLE decoding: if 2 msb == 1 then we have to mask out count
         * and repeat following byte count times
         */
        while (row < this.height) {
            isRLE = this._isRLE(offset);

            if (!isRLE) {
                length = 1;
                val = this.byteView[offset];
            } else {
                length = this._lengthRLE(offset);
                val = this.byteView[offset+1];             
            }
            i = 0;
            while (i < length) {
                this.pcx_pixels[pos++] = val;
                col++;
                if (col >= this.width) {
                    plane++;
                    offset += this.header.bpr - col;
                    if (plane > this.planes - 1) {
                        plane = 0;
                        i = length;
                        row++;
                    }
                    col = 0;
                }
                i++;
            }
            if (isRLE) {
                offset += 2;
            } else {
                offset++;
            }
        }
    },

    toRGBA: function(ctx) {
        this.pixels = ctx.createImageData(this.width, this.height);
        console.log('Converting pixel format from RRRGGGBBB... to RGBARGBARGBA...');

        // convert PCX RRRGGGBBB to Canvas RGBARGBARGBA
        for (row = 0; row < this.height; row++) {
            for (plane = 0; plane < this.planes; plane++) {
                for (col = 0; col < this.width; col++) {
                    this.pixels.data[(row * this.width * 4) + (col * 4) + plane] = this.pcx_pixels[(row * this.width * this.planes) + col + (plane * this.width)];
                    // alpha data after each plane
                    if (plane === this.planes - 1) {
                        this.pixels.data[(row * this.width * 4) + (col * 4) + plane + 1] = 255;
                    }
                }
            }
        }
    },

    render: function(ctx) {
        console.log('Drawing pixel data');

        // resize canvas
        ctx.canvas.width = this.width;
        ctx.canvas.height = this.height;
        ctx.putImageData(this.pixels, 0, 0);
    }
};