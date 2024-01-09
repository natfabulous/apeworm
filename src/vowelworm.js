(function(numeric){
    "use strict";

    /**
     * @namespace
     * @const
     * @ignore
     */
    var VowelWorm = {};

    /**
     * @namespace
     * @name VowelWorm
     */
    window.VowelWorm = VowelWorm;

    /**
     * @const
     */
    var CONTEXT = new window.AudioContext();

    /**
     * A collection of all vowel worm instances. Used for attaching modules.
     * @see {@link VowelWorm.module}
     * @type {Array.<window.VowelWorm.instance>}
     */
    var instances = [];

    /**
     * A collection of modules to add to instances, whenever they are created
     * @type {Object.<string, Function>}
     */
    var modules = {};

    var DEFAULT_SAMPLE_RATE = 44100;

    var F1_MIN = 100;

    var WINDOW_SIZE = 0.016;// default .046

    /**
     * The number of filter banks to use when computing MFCCs.
     * @const
     * @type number
     */
    var NUM_FILTER_BANKS = 40;

    /**
     * The first MFCC to use in the mapping algorithms.
     * @const
     * @type number
     */
    var FIRST_MFCC = 2;

    /**
     * The last MFCC to use in the mapping algorithms.
     * @const
     * @type number
     */
    var LAST_MFCC = 25;

    var BACKNESS_MIN = 0;


    var BACKNESS_MAX = 4;

    /**
     * The minimum height value. Used for transforming between formants and height.
     * @const
     * @type number

     */
    var HEIGHT_MIN = 0;

    /**
     * The maximum height value. Used for transforming between formants and height.
     * @const
     * @type number
     */
    var HEIGHT_MAX = 3;

    VowelWorm._MFCC_WEIGHTS = {
        25: {
            height: new Float32Array([
                1.104270, 0.120389, 0.271996, 0.246571, 0.029848, -0.489273, -0.734283,
                -0.796145, -0.441830, -0.033330, 0.415667, 0.341943, 0.380445, 0.260451,
                0.092989, -0.161122, -0.173544, -0.015523, 0.251668, 0.022534, 0.054093,
                0.005430, -0.035820, -0.057551, 0.161558
            ]),
            backness: new Float32Array([
                0.995437, 0.540693, 0.121922, -0.585859, -0.443847, 0.170546, 0.188879,
                -0.306358, -0.308599, -0.212987, 0.012301, 0.574838, 0.681862, 0.229355,
                -0.222245, -0.222203, -0.129962, 0.329717, 0.142439, -0.132018, 0.103092,
                0.052337, -0.034299, -0.041558, 0.141547
            ])
        }
    };

    /**
     * Loads the regression weights from the server
     * @param boolean normalizeMFCCs indicates whether to use weights for normalized or 
     * non-normalized MFCCs
     */
    VowelWorm.loadRegressionWeights = function(normalizeMFCCs) {
        
        var weightsReq = new XMLHttpRequest();
        weightsReq.addEventListener("load", function() {

            // Parse the backness and height weights
            var xmlDoc = weightsReq.responseXML;
            var backWeightsElements = xmlDoc.getElementsByTagName("backness")[0]
                    .getElementsByTagName("weight");
            var heightWeightsElements = xmlDoc.getElementsByTagName("height")[0]
                    .getElementsByTagName("weight");
            var backWeights = [];
            var heightWeights = [];
            for (var i = 0; i < backWeightsElements.length; i++) {
                backWeights.push(backWeightsElements[i].childNodes[0].nodeValue);
                heightWeights.push(heightWeightsElements[i].childNodes[0].nodeValue);
            }
            VowelWorm._MFCC_WEIGHTS[25].backness = new Float32Array(backWeights);
            VowelWorm._MFCC_WEIGHTS[25].height = new Float32Array(heightWeights);
        })
        if (normalizeMFCCs) {
            weightsReq.open("GET", "training/weights_norm_mfcc.xml", true);        
        }
        else {
            weightsReq.open("GET", "training/weights.xml", true);
        }
        weightsReq.send();
    }
    

    /**
     * Given an array of fft data, returns backness and height coordinates
     * in the vowel space.
     * @param {Array.<number>} fftData The fftData to map
     * @return {Array.<number>} an array formatted thusly: [x,y]. May be empty
     * @nosideeffects
     */
    VowelWorm._MAPPING_METHODS = {
        linearRegression: function(fftData, options) {

            // Get the mfccs to use as features
            var mfccs = window.AudioProcessor.getMFCCs({
                fft: fftData,
                fftSize: options.fftSize,
                minFreq: options.minHz,
                maxFreq: options.maxHz,
                filterBanks: NUM_FILTER_BANKS,
                sampleRate: options.sampleRate,
            });

            // Predict the backness and height using multiple linear regression
            if(mfccs.length) {

                // Get the specified MFCCs to use as regressors (features)
                // Also makes a copy of mfccs (since they are changing with the streaming audio)
                var features = mfccs.slice(FIRST_MFCC - 1, LAST_MFCC);

                // Normalize the MFCC vector
                if (window.game.normalizeMFCCs) {
                    var normSquared = 0;
                    for (var i = 0; i < features.length; i++) {
                        normSquared += features[i] * features[i];
                    }
                    for (var i = 0; i < features.length; i++) {
                        features[i] /= Math.sqrt(normSquared);
                    }                    
                }

                // Insert DC coefficient for regression
                features.splice(0, 0, 1);

                // Check for corresponding weights
                if (VowelWorm._MFCC_WEIGHTS[features.length] === undefined) {
                    throw new Error("No weights found for mfccs of length " +
                        mfccs.length + ". If you are using getMFCCs, make sure the " +
                        "amount of filter banks you are looking for corresponds to one of " +
                        "the keys found in VowelWorm._MFCC_WEIGHTS.");
                }

                // Do the prediction
                var backness = window.MathUtils.predict(features, VowelWorm._MFCC_WEIGHTS[features.length].backness);
                var height = window.MathUtils.predict(features, VowelWorm._MFCC_WEIGHTS[features.length].height);

                return [backness, height];
            } 
            return [];
        },
        mfccFormants: function(fftData, options) {

            var mfccs = window.AudioProcessor.getMFCCs({
                fft: fftData,
                fftSize: options.fftSize,
                minFreq: options.minHz,
                maxFreq: options.maxHz,
                filterBanks: options.numFilterBanks,
                sampleRate: options.sampleRate
            });

            if(mfccs.length) {

                // Convert the mfccs to formants
                var formants = window.AudioProcessor.getFormantsFromMfccs(mfccs);
                var backness;
                var height;
                if (formants.length > 0) {
                    var pos = mapFormantsToIPA(formants[0], formants[1]);
                }

                return [backness, height];
            } 
            return [];
        },
        cepstrumFormants: function(fftData, options) {
            var cepstrum = window.AudioProcessor.getCepstrum(fftData, {});

            if(cepstrum.length) {

                // Convert the cepstrum to formants
                var formants = window.AudioProcessor.getFormantsFromCepstrum(cepstrum, {
                    numFormants: 2,
                    sampleRate: options.sampleRate,
                    fftSize: options.fftSize,
                    cutoff: 200
                });

                if (formants.length > 0) {
                    var pos = mapFormantsToIPA(formants[0], formants[1]);
                    return pos;
                }
                else {
                    return [];
                }
            }
            return [];
        }
    };

    /**
     * Maps first and second formants to the IPA vowel space.
     */
    var mapFormantsToIPA = function(f1, f2) {

        var backness = window.MathUtils.mapToScale(f2, 
            window.AudioProcessor.F2_MAX, window.AudioProcessor.F2_MIN, BACKNESS_MIN, BACKNESS_MAX);

        var height = window.MathUtils.mapToScale(f1, 
            window.AudioProcessor.F1_MAX, window.AudioProcessor.F1_MIN, HEIGHT_MIN, HEIGHT_MAX);

        return [backness, height];
    }

    VowelWorm.STREAM = 3;

    window.VowelWorm.instance = function (stream) {
        var that = this;

        this._context = CONTEXT;
        this._context.resume();
        this._analyzer = this._context.createAnalyser();
        this._sourceNode = null; // for analysis with files rather than mic input
        this._analyzer.fftSize = window.MathUtils.nextPow2(this._context.sampleRate * WINDOW_SIZE);
        this._buffer = new Float32Array(this._analyzer.frequencyBinCount);
        // this._audioBuffer = null; // comes from downloading an audio file

        // Attach an processor node to analyze data from every buffer.
        // Note: this is deprecated but the replacement has not been implemented in any browers yet.
        // See https://developer.mozilla.org/en-US/docs/Web/API/ScriptProcessorNode/onaudioprocess
        this._processorNode = this._context.createScriptProcessor(this._analyzer.fftSize, 1, 1);
        this._processorNode.onaudioprocess = function(e) {
            that.computePosition(window.game.map, window.game.smoothingConstant);
        }
        this._processorNode.connect(this._context.destination);
        
        if (stream) {
            console.log('vowelworm set Stream to ', stream.getAudioTracks())
            this.setStream(stream);
        }

        for (var name in modules) {
            if (modules.hasOwnProperty(name)) {
                attachModuleToInstance(name, that);
            }
        }
        instances.push(this);
    };
    VowelWorm.instance = window.VowelWorm.instance;

    VowelWorm.instance.prototype = Object.create(VowelWorm);
    VowelWorm.instance.constructor = VowelWorm.instance;

    var proto = VowelWorm.instance.prototype;

    /**
     * Attaches a module to the given instance, with the given name
     * @param {string} name The name of the module to attach. Should be present in
     * {@link modules} to work
     * @param {window.VowelWorm.instance} instance The instance to affix a module to
     */
    function attachModuleToInstance(name, instance) {
        instance[name] = {};
        modules[name].call(instance[name], instance);
    };

    /**
     * Callback used by {@link VowelWorm.module}
     * @callback VowelWorm~createModule
     * @param {window.VowelWorm.instance} instance
     */

    /**
     * Adds a module to instances of {@link VowelWorm.instance}, as called by
     * `new VowelWorm.instance(...);`
     * @param {string} name the name of module to add
     * @param {VowelWorm~createModule} callback - Called if successful.
     * `this` references the module, so you can add properties to it. The
     * instance itself is passed as the only argument, for easy access to core
     * functions.
     * @throws An Error when trying to create a module with a pre-existing
     * property name
     *
     * @see {@link attachModuleToInstance}
     * @see {@link modules}
     * @see {@link instances}
     * @memberof VowelWorm
     */
    VowelWorm.module = function (name, callback) {
        if (proto[name] !== undefined || modules[name] !== undefined) {
            throw new Error("Cannot define a VowelWorm module with the name \"" + name +
                "\": a property with that name already exists. May I suggest \"" + name +
                "_kewl_sk8brdr_98\" instead?");
        }
        if (typeof callback !== 'function') {
            throw new Error("No callback function submitted.");
        }
        modules[name] = callback;
        instances.forEach(function (instance) {
            attachModuleToInstance(name, instance);
        });
    };

    VowelWorm.removeModule = function (name) {
        if (modules[name] === undefined) {
            return;
        }
        delete modules[name];
        instances.forEach(function (instance) {
            delete instance[name];
        });
    };

    VowelWorm.instance.prototype.mode = null;
    VowelWorm.instance.prototype.destroy = function () {
        var index = instances.indexOf(this);
        if (index !== -1) {
            instances.splice(index, 1);
        }
        for (var i in this) {
            if (this.hasOwnProperty(i)) {
                delete this[i];
            }
        }
    };

    /**
     * The sample rate of the attached audio source
     * @return {number}
     * @memberof VowelWorm.instance
     * @nosideeffects
     */
    VowelWorm.instance.prototype.getSampleRate = function () {
        return this._context.sampleRate;
    };

    VowelWorm.instance.prototype.getFFTSize = function () {
        return this._analyzer.fftSize;
    };


    VowelWorm.instance.prototype.getFFT = function () {
        this._analyzer.getFloatFrequencyData(this._buffer);
        return this._buffer;
    };

    VowelWorm.instance.prototype.timestamps = [];
    VowelWorm.instance.prototype.ffts = [];
    VowelWorm.instance.prototype.timeDomainData = [];
    VowelWorm.instance.prototype.positions = [];
    VowelWorm.instance.prototype.positionSMA = [];
    VowelWorm.instance.prototype.computePosition = function (mappingMethod, smoothingConstant) {

        var buffer = this.getFFT();

        // Copy the fft data since it will change as audio streams in
        var fft = [];
        for (var i = 0; i < buffer.length; i++) {
          fft.push(buffer[i]);
        }

        // Map the fft data to (backness, height) coordinates in the vowel space
        var position = mappingMethod(fft, {
          fftSize: this.getFFTSize(),
          minHz: window.game.minHz,
          maxHz: window.game.maxHz,
          sampleRate: this.getSampleRate()
        });

        // Smooth the position over time
        if (this.positions.length == 0) {
            this.positionSMA = position;
        }
        else if (this.positions.length < smoothingConstant) {
            // Compute each coordinate separately
            for (var i = 0; i < this.positionSMA.length; i++) {
                // Until we have enough previous data, this is the same as the cumulative moving average
                this.positionSMA[i] = (position[i] + this.positions.length * this.positionSMA[i]) / 
                        (this.positions.length + 1)
            }
        }
        else {
            var oldPosition = this.positions[0];
            for (var i = 0; i < this.positionSMA.length; i++) {
                this.positionSMA[i] += (position[i] - oldPosition[i]) / this.positions.length;
            }
            this.positions = this.positions.slice(1);
        }
        // Make sure to store this position for next time
        this.positions.push(position);
    }

    VowelWorm.instance.prototype.getPosition = function () {
        return this.positionSMA;
    }

    VowelWorm.instance.prototype.resetPosition = function() {
        this.positions = [];
        this.positionSMA = [];
    }


    VowelWorm.instance.prototype.setStream = function (stream) {

            this._loadFromStream(stream);

    };

    VowelWorm.instance.prototype._loadFromStream = function (stream) {
        this._sourceNode = this._context.createMediaStreamSource(stream);
        this._sourceNode.connect(this._analyzer);
        this._sourceNode.connect(this._processorNode);
    };


}(window.numeric));
