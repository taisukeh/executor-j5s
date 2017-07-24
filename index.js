'use strict';

const Executor = require('screwdriver-executor-base');
const path = require('path');
const jenkins = require('jenkins');
const fs = require('fs');
const Breaker = require('circuit-fuses');

class J5sExecutor extends Executor {

    /**
     * JenkinsClient command to run
     * @method _jenkinsCommand
     * @param  {Object}   options            An object that tells what command & params to run
     * @param  {String}   options.module     Jenkins client module. For example: job, build
     * @param  {String}   options.action     Jenkins client action in the given module. For example: get, create
     * @param  {Array}    options.params     Parameters to run with
     * @return {Promise}
     */
    _jenkinsCommand(options, callback) {
        options.params.push(callback);

        this.jenkinsClient[options.module][options.action].apply(
            this.jenkinsClient[options.module],
            options.params);
    }

    _jenkinsJobCreateOrUpdate(jobName, xml, cb) {
        return Promise.resolve().then(() =>
            this.breaker.runCommand({ module: 'job',
                                      action: 'exists',
                                      params: [{ name: jobName}]})
        ).then((exists) => {
            if(exists) {
                return this.breaker.runCommand({module: 'job',
                                                action: 'config',
                                                params: [{ name: jobName, xml: xml}]});
            } else {
                return this.breaker.runCommand({module: 'job',
                                                action: 'create',
                                                params: [{ name: jobName, xml: xml}]});
            }
        });
    }

    _jobName(buildId){
        return`SD-${buildId}`;
    }

    /**
     * Constructor
     * @method constructor
     * @param  {Object} options           Configuration options
     * @param  {Object} options.ecosystem                        Screwdriver Ecosystem
     * @param  {Object} options.ecosystem.api                    Routable URI to Screwdriver API
     * @param  {Object} options.ecosystem.store                  Routable URI to Screwdriver Store
     * @param  {String} options.host      Jenkins hostname to make requests to
     * @param  {String} options.port      Jenkins port to make requests to
     * @param  {String} options.username  Jenkins username
     * @param  {String} options.password  Jenkins password/token
     * @param  {String} [options.fusebox]                            Options for the circuit breaker (https://github.com/screwdriver-cd/circuit-fuses)
     */
    constructor(options) {
        super();
        this.ecosystem = options.ecosystem;
        this.host = options.host;
        this.port = options.port;
        this.username = options.username;
        this.password = options.password;
        // need to pass port number in the future
        this.baseUrl = `http://${this.username}:${this.password}@${this.host}:${this.port}`;
        this.jenkinsClient = jenkins({
            baseUrl: this.baseUrl,
            crumbIssuer: true
        });

        // eslint-disable-next-line no-underscore-dangle
        this.breaker = new Breaker(this._jenkinsCommand.bind(this));
    }

    /**
     * Create a jenkins job and start the build
     * @method _start
     * @param  {Object}   config            A configuration object
     * @param  {String}   config.buildId    ID for the build and also name of the job in jenkins
     * @param  {String}   config.container  Container for the build to run in
     * @param  {String}   config.token      JWT to act on behalf of the build
     * @return {Promise}
     */
    _start(config) {
        console.log('=== executor-j5s _start ===');
        console.log(config);

        const jobName = this._jobName(config.buildId);

        return new Promise((resolve, reject) => {
            const configPath = path.resolve(__dirname, './config/test-job.xml');

            fs.readFile(configPath, 'utf-8', (err, fileContents) => {
                if (err) {
                    return reject(err);
                }

                return resolve(fileContents);
            });
        }).then(xml =>
            this._jenkinsJobCreateOrUpdate(jobName, xml)
        ).then(() => {
            console.log('=== executor-j5s _start job build ===');
            const parameters = {
                SD_BUILDID: String(config.buildId),
                SD_TOKEN: config.token,
                SD_API: this.ecosystem.api,
                SD_STORE:this.ecosystem.store,
            };
            return this.breaker.runCommand({
                module: 'job',
                action: 'build',
                params: [{name: jobName, parameters }]
            });
        });
    }

    /**
     * Stop the build
     * @method _stop
     * @param  {Object}   config            A configuration object
     * @param  {String}   config.buildId    ID for the build and also name of the job in jenkins
     * @return {Promise}
     */
    _stop(config) {
        console.log('=== executor-j5s _stop ===');
        console.log(config);

        const jobName = this._jobName(config.buildId);

        return this.breaker.runCommand({
            module: 'job',
            action: 'get',
            params: [jobName]
        }).then((data) => {
            if (!(data && data.lastBuild && data.lastBuild.number)) {
                throw new Error('No build has been started yet, try later');
            }

            return this.breaker.runCommand({
                module: 'build',
                action: 'stop',
                params: [{name: jobName, number: data.lastBuild.number}]
            });
        }).then(() => /*this.breaker.runCommand({
                module: 'job',
                action: 'destroy',
                params: [{name: jobName}]
        })*/ 10);
    }
}

module.exports = J5sExecutor;
