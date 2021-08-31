"use strict";

let check = function(pathToPackage) {

    const path = require('path');
    const Promise = require('bluebird');
    const exec = Promise.promisify(require('child_process').exec);
    const fs = require('fs');
    const jsonfile = require('jsonfile');
    const validatorRules = require('./validatorRules');
    const promiseHelpers = require('./promiseHelpers');
    const colors = require('colors');

    let engines;

    const checkerResult = {
        status: 0,
        message: {},
        packages: []
    };

    const packageJsonPath = pathToPackage || path.join(process.cwd(), 'package.json');
    try {
        fs.accessSync(packageJsonPath);
        engines = jsonfile.readFileSync(packageJsonPath).engines;
    }
    catch (ex) {
        checkerResult.message = {
            text: `✘ '${packageJsonPath}' not found in the current directory so I can't validate what you need!`,
            type: 'error'
        };
        checkerResult.status = -1;

        return Promise.resolve(checkerResult);
    }

    if (!engines) {
        checkerResult.message = {
            text: '✘ No engines found in package.json so I can\'t validate what you need!',
            type: 'error'
        };
        checkerResult.status = -1;

        return Promise.resolve(checkerResult);
    }

    const thingsToCheck = Object.getOwnPropertyNames(engines);
    const validatorPromises = thingsToCheck.map(validate); // run the function over all items.

    return promiseHelpers.allSettled(validatorPromises)
        .then((inspections) => {
            const environmentIsValid = inspections.every(
                (inspection) => inspection.isFulfilled() && inspection.value()
            );

            if (environmentIsValid) {
                checkerResult.message = {
                    text: 'Environment looks good!',
                    type: 'success'
                };
            }
            else {
                checkerResult.message = {
                    text: 'Environment is invalid!',
                    type: 'error'
                };
            }
            return checkerResult;
        });

    function validate(name) {
        function notFound(checker, name) {
            checker.packages.push({
                name: name,
                validatorFound: false,
                type: 'warn'
            });
            return Promise.resolve(false);
        }
        // find it in the validators
        let validator = validatorRules[name];

        if (validator === undefined) {
            if (fs.existsSync("engines.spec.json")) {
                const projectRules = JSON.parse(fs.readFileSync('engines.spec.json', 'utf-8'))
                const projectRule = projectRules.find(rule => rule.package === name);
                if (projectRule) {
                    const versionValidate = require('./validatorRules').versionValidate;
                    validator = {
                        versionCheck: projectRule.versionCheck,
                        versionValidate: versionValidate
                    }
                } else {
                    return notFound(checkerResult, name)
                }
            } else {
                return notFound(checkerResult, name)
            }
        }

        // call the validator and pass in the version we expect
        return execAndCheck(validator, engines[name]).then((results) => {
            if (results.result) {
                checkerResult.packages.push({
                    name: name,
                    validatorFound: true,
                    expectedVersion: engines[name],
                    foundVersion: engines[name],
                    type: 'success'
                });
            }
            else {
                checkerResult.packages.push({
                    name: name,
                    validatorFound: true,
                    expectedVersion: engines[name],
                    foundVersion: results.reason.trim() || 'missing',
                    type: 'error'
                });
            }

            return Promise.resolve(results.result);
        }).catch((error) => {
            checkerResult.packages.push({
                name: name,
                validatorFound: true,
                expectedVersion: engines[name],
                commandError: error,
                type: 'error'
            });
            return Promise.reject();
        });
    }

    function execAndCheck(validator, expectedVersion) {
        return exec(validator.versionCheck).then((result) => {
            return {
                result: validator.versionValidate(result, expectedVersion),
                reason: result
            };
        }).catch((e) => { throw e; });
    }
};
module.exports = check;
