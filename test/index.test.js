'use strict';

const assert = require('chai').assert;
const sinon = require('sinon');
const mockery = require('mockery');
const fs = require('fs');
const path = require('path');

sinon.assert.expose(assert, { prefix: '' });

const configPath = path.resolve(__dirname, '../config/test-job.xml');
const TEST_XML = fs.readFileSync(configPath, 'utf-8');

describe('index', () => {
    let executor;
    let Executor;
    let fsMock;
    let jenkinsMock;
    let breakerMock;
    let BreakerFactory;

    const config = {
        buildId: 1993,
        container: 'node:4',
        apiUri: 'http://localhost:8080',
        token: 'abcdefg'
    };

    const jobName = `SD-${config.buildId}`;

    const ecosystem = {
        api: 'api',
        ui: 'ui',
        store: 'store'
    };

    const buildParameters = {
        SD_BUILDID: String(config.buildId),
        SD_TOKEN: config.token,
        SD_API: ecosystem.api,
        SD_STORE: ecosystem.store
    };

    const buildIdConfig = {
        buildId: config.buildId
    };

    const fakeJobInfo = {
        lastBuild: {
            number: 1
        }
    };

    const buildNumber = fakeJobInfo.lastBuild.number;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach(() => {
        fsMock = {
            readFile: sinon.stub()
        };

        jenkinsMock = {
            job: {
                create: sinon.stub(),
                exists: sinon.stub(),
                config: sinon.stub(),
                build: sinon.stub()
            }
        };

        breakerMock = {
            runCommand: sinon.stub()
        };

        BreakerFactory = sinon.stub().returns(breakerMock);

        mockery.registerMock('fs', fsMock);
        mockery.registerMock('circuit-fuses', BreakerFactory);

        // eslint-disable-next-line global-require
        Executor = require('../index');

        executor = new Executor({
            ecosystem,
            host: 'jenkins',
            username: 'admin',
            password: 'fakepassword'
        });
    });

    afterEach(() => {
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('extends base class', () => {
        // eslint-disable-next-line global-require
        const BaseExecutor = require('../node_modules/screwdriver-executor-base/index');

        assert.instanceOf(executor, BaseExecutor);
    });

    describe('start', () => {
        let createOpts;
        let configOpts;
        let existsOpts;
        let buildOpts;

        beforeEach(() => {
            createOpts = {
                module: 'job',
                action: 'create',
                params: [{ name: jobName, xml: TEST_XML }]
            };

            configOpts = {
                module: 'job',
                action: 'config',
                params: [{ name: jobName, xml: TEST_XML }]
            };

            existsOpts = {
                module: 'job',
                action: 'exists',
                params: [{ name: jobName }]
            };

            buildOpts = {
                module: 'job',
                action: 'build',
                params: [{
                    name: jobName,
                    parameters: buildParameters
                }]
            };
        });

        it('return null when the job is successfully created', (done) => {
            fsMock.readFile.yieldsAsync(null, TEST_XML);

            breakerMock.runCommand.withArgs(existsOpts).resolves(false);

            executor.start(config).then(() => {
                assert.calledOnce(fsMock.readFile);
                assert.calledWith(fsMock.readFile, configPath);
                assert.calledWith(breakerMock.runCommand, existsOpts);
                assert.calledWith(breakerMock.runCommand, createOpts);
                assert.calledWith(breakerMock.runCommand, buildOpts);
                done();
            });
        });

        it('update job when job already exists', (done) => {
            fsMock.readFile.yieldsAsync(null, TEST_XML);

            breakerMock.runCommand.withArgs(existsOpts).resolves(true);

            executor.start(config).then(() => {
                assert.calledOnce(fsMock.readFile);
                assert.calledWith(fsMock.readFile, configPath);
                assert.calledWith(breakerMock.runCommand, existsOpts);
                assert.calledWith(breakerMock.runCommand, configOpts);
                assert.calledWith(breakerMock.runCommand, buildOpts);
                done();
            });
        });

        it('return error when fs.readFile is getting error', (done) => {
            const error = new Error('fs.readFile error');

            fsMock.readFile.yieldsAsync(error);

            executor.start(config).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });

        it('return error when job.create is getting error', (done) => {
            const error = new Error('job.create error');

            fsMock.readFile.yieldsAsync(null, TEST_XML);
            breakerMock.runCommand.withArgs(createOpts).rejects(error);

            executor.start(config).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });

        it('return error when job.build is getting error', (done) => {
            const error = new Error('job.build error');

            fsMock.readFile.yieldsAsync(null, TEST_XML);
            breakerMock.runCommand.withArgs(createOpts).resolves('ok');
            breakerMock.runCommand.withArgs(buildOpts).rejects(error);

            executor.start(config).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });

        it('return error when job.config is getting error', (done) => {
            const error = new Error('job.build error');

            fsMock.readFile.yieldsAsync(null, TEST_XML);
            breakerMock.runCommand.withArgs(existsOpts).resolves(true);
            breakerMock.runCommand.withArgs(configOpts).rejects(error);

            executor.start(config).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });
    });

    describe('stop', () => {
        let getOpts;
        let stopOpts;
        let destroyOpts;

        beforeEach(() => {
            getOpts = {
                module: 'job',
                action: 'get',
                params: [{ name: jobName }]
            };

            stopOpts = {
                module: 'build',
                action: 'stop',
                params: [{ name: jobName, number: buildNumber }]
            };

            destroyOpts = {
                module: 'job',
                action: 'destroy',
                params: [{ name: jobName }]
            };
        });

        it('return null when the build is successfully stopped', (done) => {
            breakerMock.runCommand.withArgs(getOpts).resolves(fakeJobInfo);
            breakerMock.runCommand.withArgs(stopOpts).resolves(null);
            breakerMock.runCommand.withArgs(destroyOpts).resolves(null);

            executor.stop(buildIdConfig).then((ret) => {
                assert.isNull(ret);
                assert.calledWith(breakerMock.runCommand, getOpts);
                assert.calledWith(breakerMock.runCommand, stopOpts);
                assert.calledWith(breakerMock.runCommand, destroyOpts);
                done();
            });
        });

        it('return error when there is no build to be stopped yet', (done) => {
            const noBuildJobInfo = {
                lastBuild: null
            };

            breakerMock.runCommand.withArgs(getOpts).resolves(noBuildJobInfo);
            breakerMock.runCommand.withArgs(stopOpts).resolves(null);

            executor.stop(buildIdConfig).catch((err) => {
                assert.deepEqual(err.message, 'No build has been started yet, try later');
                done();
            });
        });

        it('return error when job.get is getting error', (done) => {
            const error = new Error('job.get error');

            breakerMock.runCommand.withArgs(getOpts).rejects(error);
            breakerMock.runCommand.withArgs(stopOpts).resolves();

            executor.stop(buildIdConfig).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });

        it('return error when build.stop is getting error', (done) => {
            const error = new Error('build.stop error');

            breakerMock.runCommand.withArgs(getOpts).resolves(fakeJobInfo);
            breakerMock.runCommand.withArgs(stopOpts).rejects(error);

            executor.stop(buildIdConfig).catch((err) => {
                assert.deepEqual(err, error);
                done();
            });
        });
    });

    describe('run without Mocked Breaker', () => {
        beforeEach(() => {
            mockery.deregisterMock('circuit-fuses');
            mockery.resetCache();

            // eslint-disable-next-line global-require
            Executor = require('../index');

            executor = new Executor({
                ecosystem,
                host: 'jenkins',
                username: 'admin',
                password: 'fakepassword'
            });

            jenkinsMock.job.create = sinon.stub(executor.jenkinsClient.job, 'create');
            jenkinsMock.job.config = sinon.stub(executor.jenkinsClient.job, 'config');
            jenkinsMock.job.exists = sinon.stub(executor.jenkinsClient.job, 'exists');
            jenkinsMock.job.build = sinon.stub(executor.jenkinsClient.job, 'build');
        });

        it('calls jenkins function correctly', (done) => {
            fsMock.readFile.yieldsAsync(null, TEST_XML);
            jenkinsMock.job.exists.yieldsAsync(null, false);
            jenkinsMock.job.create.yieldsAsync(null);
            jenkinsMock.job.build.yieldsAsync(null);

            executor.start(config).then(() => {
                assert.calledWith(jenkinsMock.job.create, { name: jobName, xml: TEST_XML });
                assert.calledWith(jenkinsMock.job.build,
                                  { name: jobName, parameters: buildParameters });
                done();
            });
        });
    });
});
