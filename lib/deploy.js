/* jshint node: true */
'use strict';

var Docker  = require('dockerode');
var url     = require('url');
var _       = require('lodash');
var async   = require('async');
var util    = require('./util');
var service = require('./service');

var DOCKER_PORT = 2375;
var PORT_RANGE  = _.range(8000, 8999);

function dockerCmd() {
  var args = _.toArray(arguments);
  var hostname = args.shift();
  var cmd = args.shift();
  var docker = new Docker({
    host: 'http://' + hostname,
    port: DOCKER_PORT,
  });
  docker[cmd].apply(docker, args);
}

function loadContainer(hostname, containerId, fn) {
  dockerCmd(hostname, 'getContainer', containerId, fn);
}

function inspectContainer(hostname, containerId, fn) {
  loadContainer(hostname, containerId, function(err, container) {
    container.inspect(fn);
  });
}

function createContainer(hostname, createOptions, fn) {
  dockerCmd(hostname, 'createContainer', createOptions, fn);
}

function startContainer(hostname, containerId, externalPort, fn) {
  loadContainer(hostname, containerId, function(err, container) {
    container.start({
      'PortBindings': {
        '3000/tcp': [{'HostPort': ''+externalPort}]
      }
    }, fn);
  });
}

function createAndStartContainer(hostname, externalPort, createOptions, fn) {
  async.waterfall([
    function(fn) {
      createContainer(hostname, createOptions, fn);
    },
    function(container, fn) {
      startContainer(hostname, container.Id, externalPort, fn);
    }
  ], fn);
}

function runContainer(config, fn) {

  var createOptions = {
    'Hostname': '',
    'User': '',
    'AttachStdin': false,
    'AttachStdout': true,
    'AttachStderr': true,
    'Tty': true,
    'OpenStdin': false,
    'StdinOnce': false,
    'Env': config.envs,
    'Cmd': null,
    'Image': config.image,
    'Volumes': {},
    'VolumesFrom': '',
    'ExposedPorts': {'3000/tcp': {}},
  };

  createAndStartContainer(config.hostname, config.port, createOptions, fn);
}

function loadPortsInUse(hostname, fn) {
  loadContainers(hostname, function(err, containers) {
    if (err) {
      return fn(err);
    }
    var portsInUse = _.map(containers, function(container) {
      return container.Ports[0].PublicPort;
    });
    fn(null, portsInUse);
  });
}

function findAvailablePort(hostname, fn) {
  loadPortsInUse(hostname, function(err, portsInUse) {
    if (err) {
      return fn(err);
    }
    var port = _.sample(_.difference(PORT_RANGE, portsInUse));
    fn(null, port);
  });
}

function pullDockerImage(hostname, image, fn) {
  // TODO: Pull from external repo (https://docs.docker.com/reference/api/docker_remote_api_v1.12/)
  dockerCmd(hostname, 'pull', image, fn);
}

function loadContainers(hostname, fn) {
  dockerCmd(hostname, 'listContainers', fn);
}

function stopContainer(hostname, containerId, fn) {
  dockerCmd(hostname, 'getContainer', containerId, fn);
}

function stopContainerByPort(hostname, port, fn) {
  loadContainers(hostname, function(err, containers) {
    var match = _.find(containers, function(container) {
      return container.Ports[0].PublicPort == port;
    });
    if (match) {
      stopContainer(match.Id, fn);
    }
    else {
      fn(null, null);
    }
  });
}

function loadNewInstanceConfig(domain, hostname, image, fn) {
  async.parallel({
    port: _.partial(findAvailablePort, hostname),
    envs: _.partial(service.loadAppEnvs, domain),
  }, function(err, config) {
    if (err) {
      return fn(err);
    }
    config.image    = image;
    config.hostname = hostname;
    config.domain   = domain;
    fn(null, config);
  });
}

function deployAppInstance(domain, hostname, existingPort, image, fn) {
  loadNewInstanceConfig(domain, hostname, image, function(err, config) {
    if (err) {
      return fn(err);
    }
    async.waterfall([
      function(fn) {
        console.log('Pulling new tags for ' + config.image);
        pullDockerImage(config.hostname, config.image, fn);
      },
      function(pullInfo, fn) {
        console.log('Starting new container at ' + config.hostname + ':' + config.port);
        runContainer(config, fn);
      },
      function(container, fn) {
        console.log('Checking host health');
        util.healthCheckHost(config.hostname, config.port, fn);
      },
      function(success, fn) {
        if (!success) {
          fn(new Error('Failed to deploy new instance.'));
        }
        else {
          console.log('Adding ' + config.hostname + ':' + config.port + ' to router');
          service.addHostToPool(config.domain, config.hostname, config.port, fn);
        }
      },
      function(result, fn) {
        console.log('Removing ' + config.hostname + ':' + config.port + ' from router');
        service.removeHostFromPool(config.domain, config.hostname, existingPort, fn);
      }
    ], function(err, result) {
      if (err) {
        console.log('Deploy error. Rolling back.', err);
        rollbackContainer(config, existingPort, fn);
      }
      else {
        console.log('Stopping previous application container');
        stopContainer(config.hostname, existingPort, fn);
      }
    });
  });
}

function rollbackContainer(config, existingPort, fn) {
  async.series([
    function(fn) {
      service.addHostToPool(config.domain, config.hostname, existingPort, fn);
    },
    function(fn) {
      service.removeHostFromPool(config.domain, config.hostname, config.port, fn);
    },
  ], fn);
}

function deployAppInstances(domain, image, fn) {
  service.loadAppHosts(domain, function(err, hosts) {
    if (err) {
      return fn(err);
    }
    async.map(hosts, function(host, fn) {
      var hostname = util.getHostnameFromHost(host);
      var port = util.getPortFromHost(host);
      deployAppInstance(domain, hostname, port, image, fn);
    }, fn);
  });
}

exports.deployAppInstances = deployAppInstances;