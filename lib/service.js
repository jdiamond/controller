/* jshint node: true */
'use strict';

var async    = require('async');
var _        = require('lodash');
var redisCmd = require('./redis');

function loadApps(fn) {
  redisCmd('smembers', 'domains', fn);
}

function loadAppHosts(domain, fn) {
  redisCmd('smembers', domain + ':hosts', fn);
}

function loadAppEnvs(domain, fn) {
  redisCmd('smembers', domain + ':envs', fn);
}

function addAppEnv(domain, env, fn) {
  redisCmd('sadd', domain + ':envs', env, fn);
}

function removeAppEnv(domain, env, fn) {
  loadAppEnvs(domain, function(err, envs) {
    if (err) {
      return fn(err);
    }
    var matches = _.filter(envs, function(e) {
      return new RegExp('^' + env).test(e);
    });
    async.map(matches, function(match, fn) {
      redisCmd('srem', domain + ':envs', match, fn);
    }, fn);
  });
}

function addHostToApp(domain, hostname, port, fn) {
  redisCmd('sadd', domain + ':hosts', hostname + ':' + port, fn);
}

function removeHostFromApp(domain, hostname, port, fn) {
  redisCmd('srem', domain + ':hosts', hostname + ':' + port, fn);
}

function loadHosts(fn) {
  redisCmd('smembers', 'hosts', fn);
}

function addHost(host, fn) {
  redisCmd('sadd', 'hosts', host, fn);
}

function removeHost(host, fn) {
  redisCmd('srem', 'hosts', host, fn);
}

exports.loadApps          = loadApps;
exports.loadAppEnvs       = loadAppEnvs;
exports.loadAppHosts      = loadAppHosts;
exports.removeAppEnv      = removeAppEnv;
exports.addHostToApp      = addHostToApp;
exports.removeHostFromApp = removeHostFromApp;
exports.loadHosts         = loadHosts;
exports.addHost           = loadHosts;
exports.removeHost        = removeHost;