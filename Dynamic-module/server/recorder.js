'use strict';
/**
 * Recorder module
 * Spin-up monitors, schedule video recompression, cataloging and cleanup
 * */

var Promise = require('bluebird'),
  path = require('path'),
  moment = require('moment'),
  winston = require('winston'),
  YAML = require('js-yaml');

/**
 * Crockford's Functional Inheritance OOP model or "decorator pattern"
 * In fact, inheritance itself is not used in this project
 * */
module.exports = function createRecorder(options){
 
 var   tasks = [],
    monitorInterval,
    checkRecordingInterval,
    runningTask,
    taskStatus,
    fse = options.fse,
    cleanRecordingCheck = Promise.resolve(),
    recordingDir = path.join(options.workDir, 'recording'),
    cleaner = options.createCleaner({
      regression: options.cleaner,
	recordingDir: recordingDir,
      cameras: []
    });
	

  // Recorder object
  var that = {
    config: options,
    monitors: [],
	cataloger: options.createCataloger({
      catalogDir: recordingDir,
      catalogName: options.catalogName,
      cameras: options.cameras
    })
    
  };

  // creating monitors
  options.cameras.forEach(function (camera){
    var monitor = options.createMonitor({
	recorder:that,
      cameraName: camera[0],
      cameraAddr: camera[1],
      recordingDir: recordingDir,
      cleaner: cleaner,
	segment:options.segDursec,

	cataloger: that.cataloger,
      startTime: camera[2],
      stopTime: camera[3],
	endDate:options.endDate,
	startDate: options.startDate,
      consoleLog: options.monitorConsoleLog,
      fileLog: true,
      createFfmpeg: options.createFfmpeg,
      fse: fse
    });

    cleaner.config.cameras.push(camera[0]);
    if (options.monitorLog) {
      monitor.on('log', function (message){
        logger.info('monitor ' + camera[0] + ': ' + message);
      });
    }
    that.monitors.push(monitor);
  });

  function timestamp(){
    return moment().format('YYYY-MM-DD HH:mm:ss.SSS');
  }

  var loggerConf = {
    transports: [
      new (winston.transports.File)({
        filename: path.join(options.workDir, 'recorder_log.txt'),
        showLevel: false,
        json: false,
        timestamp: timestamp
      })
    ]
  };

  if (options.recorderConsoleLog) {
    loggerConf.transports.push(
      new (winston.transports.Console)({
        showLevel: false,
        timestamp: timestamp
      }));
  }
  var logger = new winston.Logger(loggerConf);

  logger.on('error', function (err){
    console.log('logger error');
    console.log(err);
  });

  function log(message){
    logger.info('recorder: ' + message);
  }

  function taskLog(message){
    logger.info('task: ' + message);
  }

  
  that.cataloger.on('log', function (message){
    logger.info('cataloger: ' + message);
  });


  cleaner.on('log', function (message){
    logger.info('cleaner: ' + message);
  });

 
  function taskOnFinish(){
    cleaner.clean()
          .then(function (){
            runningTask = undefined;
            if (tasks.length > 0) {
              tasks[0].taskDelay = moment().add(5, 's');
              log('delaying next task')
            } else {
              log('no more tasks')
            }
          });
     
  }

  function checkMonitors(){
    if (!runningTask && tasks.length > 0) {
      if (moment().diff(tasks[0].taskDelay) > 0) {
        runningTask = tasks.shift();
        taskStatus = undefined;
      
      }
    }
  }

  function checkRecordingDir(){
    if (!runningTask && tasks.length === 0) {
      if (!cleanRecordingCheck.isPending()) {
        return fse.readFileAsync(path.join(__dirname, 'convert_day.yaml'))
          .then(function (file){
            var convertDay = YAML.load(file) || [];
            if (!convertDay || !convertDay.length) {
              convertDay = [];
            }
            var finishedDate = moment();
            if (moment().hours() < moment(options.startTime, 'HH:mm:ss').hours()) {
              finishedDate.add(-1, 'd');
            }
            convertDay.push(finishedDate.format('YYYYMMDD'));
            return Promise.map(convertDay, checkDay);
          });
      }
    }
  }

  function checkDay(finishedDay){
    cleanRecordingCheck = Promise.map(that.monitors, function (monitor){
      if (monitor.state === 'sleeping') {
	
        return fse.readdirAsync(path.join(recordingDir, monitor.config.cameraName, finishedDay))
          .call('filter', function (fileName){
            return path.parse(fileName).ext === '.mp4' && fileName.length === 23;
          })
          .then(function (files){
            if (files && files.length > 0) {
              log('found not converted recording');
              that.scheduleTask(monitor, finishedDay);
            }
          })
          .catch(function (err){
            if (err.code !== 'ENOENT') {
              log(err);
            }
          });
      }
    });
  }

  that.scheduleTask = function scheduleTask(monitor, finishedDay){
    log('scheduling tasks with delay');
    tasks.push({
      type: 'segment',
      cameraName: monitor.config.cameraName,
      workDay: finishedDay,
      recordingDir: path.join(recordingDir, monitor.config.cameraName, finishedDay),

      autoClean: true,
      hardClean: false,
      taskDelay: moment().add(5, 's')
    });
    tasks.push({
      type: 'motion',
      cameraName: monitor.config.cameraName,
      workDay: finishedDay,
      motionDir: path.join(recordingDir, monitor.config.cameraName, 'motion'),
      motionMove: true,
      recordingDir: path.join(recordingDir, monitor.config.cameraName, finishedDay),
      autoClean: true,
      hardClean: true,
      taskDelay: moment().add(5, 's')
    });
  };

  that.start = function start(){
    return cleaner.clean()
.then(that.cataloger.rebuildAll)
      .then(that.cataloger.write)
      .then(function (){
        if (!options.noRecording) {
          that.monitors.forEach(function (monitor){
            monitor.start();
            monitor.on('sleep', function (finishedDay){
              if (finishedDay && finishedDay.length === 8) {
                that.scheduleTask(monitor, finishedDay);
              }
            });
          });
          if (monitorInterval) {
            clearInterval(monitorInterval);
          }
          monitorInterval = setInterval(checkMonitors, 1000);
          if (checkRecordingInterval) {
            clearInterval(checkRecordingInterval);
          }
          checkRecordingInterval = setInterval(checkRecordingDir, 60000);
        } else {
          log('noRecording is set');
        }
      });
  };
that.getmons=function getmons(monrec){

var newmonitor = monrec.config.createMonitor({

      cameraName:monrec.config.cameras[monrec.config.cameras.length-1][0],
      cameraAddr: monrec.config.cameras[monrec.config.cameras.length-1][1],
      recordingDir: recordingDir,
      cleaner: monrec.config.cleaner,
	segment:monrec.config.segDursec,
	numcams:monrec.config.noofcamera,
	cataloger:monrec.cataloger,
      startTime: monrec.config.cameras[monrec.config.cameras.length-1][2],
      stopTime: monrec.config.cameras[monrec.config.cameras.length-1][3],
	endDate:monrec.config.endDate,
	startDate:monrec.config.startDate,
      consoleLog: monrec.config.monitorConsoleLog,
      fileLog: true,
      createFfmpeg: monrec.config.createFfmpeg,
      fse: fse
    });

cleaner.config.cameras.push(monrec.config.cameras[monrec.config.cameras.length-1][0]);
    if (monrec.config.monitorLog) {
      newmonitor.on('log', function (message){
        logger.info('monitor ' + monrec.config.cameras[monrec.config.cameras.length-1][0] + ': ' + message);
      });
    }
    monrec.monitors.push(newmonitor);
newmonitor.start();
 newmonitor.on('sleep', function (finishedDay){
              if (finishedDay && finishedDay.length === 8) {
                that.scheduleTask(newmonitor, finishedDay);
              }
            });


}
  that.stop = function stop(){
    if (!options.noRecording) {
      that.monitors.map(function (monitor){
        monitor.stop();
      });
      if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = undefined;
      }
      if (checkRecordingInterval) {
        clearInterval(checkRecordingInterval);
        checkRecordingInterval = undefined;
      }
    }
  };

  return that;
};
