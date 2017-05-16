"use strict";
(function(window, document) {
    function Defer() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    window.initBrowserFileReader = {
        init: function(options) {
            var dropZone = options.dropZone,
                canvas = options.canvas,
                context = canvas.getContext('2d');

            // not used but required for drop to work
            dropZone.addEventListener('dragover', (e) => {
                e.stopPropagation();
                e.preventDefault();
            });

            dropZone.addEventListener('drop', (e) => {
                console.log('Dropped file');
                e.stopPropagation();
                e.preventDefault();

                var dt = e.dataTransfer,
                    files = dt.files,
                    file = files.length && files[0] || null;

                this.loadFile(file)
                .then((buffer) => {
                    var pcx = new PCX(buffer);

                    var pcxData = pcx.decode(context);

                    this.render(context, pcxData);

                })
                .catch(function(error) {
                    console.log("Error reading PCX File: ", error);
                })
            });
        },
        /**
         * Renders decoded and converted pixel data onto the specified canvas context.
         * 
         * @param {CanvasContext} ctx The context to render the pixels on.
         */
        render: function(ctx, pcxData) {
            console.log('Drawing pixel data');
            const width = pcxData.width,
                  height = pcxData.height;

            // resize canvas
            ctx.canvas.width = width;
            ctx.canvas.height = height;
            var imageData = new ImageData(width, height);
            imageData.data.set(pcxData.pixelArray);

            ctx.putImageData(imageData, 0, 0);

        },
        /**
         * Loads the file into an `ArrayBuffer` so that it's
         * ready to be decoded
         * 
         * @returns {Defer} A promise
         */
        loadFile: function(file) {
            console.log('Loading file');
            var def = new Defer();

            var reader = new FileReader();
            
            reader.onload = (e) => {
                console.log(`File loaded, length = ${e.target.result.byteLength} bytes`);
                this.buffer = e.target.result;
                this.byteView = new Uint8Array(e.target.result);
                def.resolve(this.buffer);
            }

            reader.readAsArrayBuffer(file);

            return def.promise;
        },        
    }
})(this, document);