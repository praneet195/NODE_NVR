'use strict';
/**
 * Manages recording video from one camera using finite state machine model
 * States: running, to_sleeping, sleeping, stopping, stopped, error, restarting
 * Inherits EventEmitter
 * Emits: log, state, ffmpeg_log, error, stop, sleep
 * */
const { exec } = require('child_process');
var EventEmitter = require('events').EventEmitter,
  moment = require('moment'),
  path = require('path'),
 Promise = require('bluebird'),
 fse = Promise.promisifyAll(require('fs-extra')),
child_process = require('child_process'),
  winston = require('winston'),
  YAML = require('js-yaml'),
delayInMilliseconds = 5000,
checkcams=0,
  startconf= YAML.load(fse.readFileSync(path.join(__dirname, 'config.yaml'))).recorder;
var isEqual = function (value, other) {

	// Get the value type
	var type = Object.prototype.toString.call(value);

	// If the two objects are not the same type, return false
	if (type !== Object.prototype.toString.call(other)) return false;

	// If items are not an object or array, return false
	if (['[object Array]', '[object Object]'].indexOf(type) < 0) return false;

	// Compare the length of the length of the two items
	var valueLen = type === '[object Array]' ? value.length : Object.keys(value).length;
	var otherLen = type === '[object Array]' ? other.length : Object.keys(other).length;
	if (valueLen !== otherLen) return false;

	// Compare two items
	var compare = function (item1, item2) {

		// Get the object type
		var itemType = Object.prototype.toString.call(item1);

		// If an object or array, compare recursively
		if (['[object Array]', '[object Object]'].indexOf(itemType) >= 0) {
			if (!isEqual(item1, item2)) return false;
		}

		// Otherwise, do a simple comparison
		else {

			// If the two items are not the same type, return false
			if (itemType !== Object.prototype.toString.call(item2)) return false;

			// Else if it's a function, convert to a string and compare
			// Otherwise, just compare
			if (itemType === '[object Function]') {
				if (item1.toString() !== item2.toString()) return false;
			} else {
				if (item1 !== item2) return false;
			}

		}
	};

	// Compare properties
	if (type === '[object Array]') {
		for (var i = 0; i < valueLen; i++) {
			if (compare(value[i], other[i]) === false) return false;
		}
	} else {
		for (var key in value) {
			if (value.hasOwnProperty(key)) {
				if (compare(value[key], other[key]) === false) return false;
			}
		}
	}

	// If nothing failed, return true
	return true;

};

module.exports = function createMonitor(options){
  var that = new EventEmitter();
  that.state = 'stopped';
  that.config = options;

  var cameraName = options.cameraName,
monrec=options.recorder,

    cameraAddr = options.cameraAddr,


	segmentdursec=options.segment,
    startTime = moment(options.startTime, 'HH:mm:ss'),
    stopTime = moment(options.stopTime, 'HH:mm:ss'),
    recordingDir = options.recordingDir,
    todayDir = '',
    thisDay = '',
	endDay=options.endDate,
	start=options.startDate,
	st=moment(start),
	cleaner=options.cleaner,
	cataloger=options.cataloger,
    finishedDay,
    ffmpeg = options.createFfmpeg({
      messageBuffer: 30,
      streaming: true,
      stopTimeout: 5000
    }),
    fse = options.fse,
    monitorInterval;

  function timestamp(){
    return moment().format('YYYY-MM-DD HH:mm:ss.SSS');
  }

  var loggerConf = {transports: []};
  if (options.fileLog) {
    loggerConf.transports.push(
      new (winston.transports.File)({
        filename: path.join(recordingDir, cameraName, "log.txt"),
        showLevel: false,
        json: false,
        timestamp: timestamp
      })
    )
  }
  if (options.consoleLog) {
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
    logger.info(message);
    that.emit('log', message);
  }

  function changeState(newState){
    that.state = newState;
    log('state: ' + newState);
    that.emit('state', newState);
  }

  ffmpeg.on('log', function (message){
    logger.info('ffmpeg ' + message);
    that.emit('ffmpeg_log', message);
  });

  ffmpeg.on('error', function (err){
    log('ffmpeg error');
    log(JSON.stringify(err));
    changeState('error');
    that.emit('error', err);
  });

  ffmpeg.on('start', function (message){
    log('ffmpeg processing started ...');
  });

  ffmpeg.on('crash', function (message){
    log('ffmpeg crash ' + ffmpeg.crashCntr);
    if (that.state === 'running') {
      setTimeout(reSpawn, 3000);
    }
  });

  ffmpeg.on('exit', function (message){
    if (that.state === 'stopping') {
      changeState('stopped');
      that.emit('stop');
    } else if (that.state === 'restarting') {
      setTimeout(reSpawn, 3000);
      changeState('running');
    } else if (that.state === 'to_sleeping') {
      changeState('sleeping');
      that.emit('sleep', finishedDay);
    }
  });

  function reSpawn(){
    log('reSpawn');
    //read from camera, split by 5min segments, stream to ffserver for live view and motion detection
    var args = '-y -i ' + cameraAddr + ' -c:v libx264 -f segment -segment_time '+segmentdursec+' -reset_timestamps 1 -probesize 3000 -strftime 1 %Y-%m-%d_%H.%M.%S.mp4';
    ffmpeg.spawn(args, todayDir);
  }

  that.start = function start(){
    log('Monitor start');
    startTime = moment(options.startTime, 'HH:mm:ss');
    stopTime = moment(options.stopTime, 'HH:mm:ss');
    thisDay = moment().format('YYYYMMDD');
    todayDir = path.join(recordingDir, cameraName, thisDay);
    return fse.ensureDirAsync(todayDir)
      .then(function (){
        if (monitorInterval) {
          clearInterval(monitorInterval);
        }
        monitorInterval = setInterval(monitor, 1000);
        changeState('sleeping');
      });
  };

  that.stop = function stop(){
    if (that.state = 'running') {
      changeState('stopping');
      ffmpeg.stop();
    }
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = undefined;
    }
  };

  function monitor(){


var newconf = YAML.load(fse.readFileSync(path.join(__dirname, 'config.yaml'))).recorder;
var numcameras=newconf.cameras.length;
if(!(isEqual(newconf,startconf))){

if(newconf.cameras.length>startconf.cameras.length){
startconf=newconf;

monrec.config.cleaner=cleaner;
monrec.config.cameras.push(newconf.cameras[newconf.cameras.length-1]);
monrec.cataloger.catalog.cameras.push({
        cameraName:newconf.cameras[newconf.cameras.length-1][0],
        folders: []
      });
monrec.getmons(monrec);
}
if(newconf.cameras.length<startconf.cameras.length){
var delcam="";

for(var i=0;i<newconf.cameras.length;i++){

for(var j=0;j<startconf.cameras.length;j++){
if(newconf.cameras[i][0].indexOf(startconf.cameras[j][0])==-1)
{
var delcam=startconf.cameras[j][0];
}
}
}
for(var i=0;i<monrec.monitors.length;i++){

if(monrec.monitors[i].config.cameraName==delcam){
monrec.monitors[i].stop();
monrec.monitors.splice(i,1);
monrec.cataloger.config.cameras.splice(i,1);
monrec.cataloger.catalog.cameras.splice(i,1);


}
}
startconf=newconf;
}
}
//delete that.config.createMonitor ;
//delete that.config.createCataloger;
//delete that.config.createCleaner ;
//delete that.config.createFfmpeg ;
//delete that.config.createFfprobe;
//delete that.config.fse;
//startconf=YAML.load(fse.readFileSync(path.join(__dirname, 'config.yaml'))).recorder;


//newconf.createMonitor = require('./monitor');
//newconf.createCataloger=require('./cataloger');
//newconf.createCleaner = require('./cleaner');
//newconf.createFfmpeg = require('./ffmpeg');
//newconf.createFfprobe = require('./ffprobe');
//newconf.fse = fse;


//recorder = require('./recorder')(newconf);

//recorder.start();/}
	
    if (that.state === 'stopped') {
      return;
    }
    if (that.state === 'running' && ffmpeg.state === 'running') {
      if (ffmpeg.status.frameProcessedOn && moment().diff(ffmpeg.status.frameProcessedOn, 'seconds') > 30) {
        log('ffmpeg hangs');
        changeState('restarting');
        ffmpeg.stop();
      }
    }
	
    var today = moment().format('YYYYMMDD');
 
if(endDay==""&& start==""){
if (thisDay !== today) {
      thisDay = today;
      todayDir = path.join(recordingDir, cameraName, thisDay);
      fse.ensureDir(todayDir, function (){
        if (that.state === 'running') {
          changeState('restarting');
		
          ffmpeg.stop();
        }
        startTime = moment(options.startTime, 'HH:mm:ss');
        stopTime = moment(options.stopTime, 'HH:mm:ss');
      });
    } else {
      var isWorkTime = moment().diff(startTime) > 0 && moment().diff(stopTime) < 0;
      if (stopTime.diff(startTime) < 0) {
        isWorkTime = !isWorkTime;
      } else if (stopTime.diff(startTime) === 0) {
        isWorkTime = true;
      }
      if (that.state === 'running' && !isWorkTime) {
        finishedDay = thisDay;
        changeState('to_sleeping');
	st.add(1,'d');
        ffmpeg.stop();
 //1 second
checkcams=checkcams+1;
if(checkcams==numcameras){
setTimeout(function() {
return cleaner.clean()
	.then(cataloger.rebuildAll)
      .then(cataloger.write)
	.then(function (){
console.log('Dropping to re-create');
exec('mongo Recordings --eval \"db.dropDatabase()\" ', (err, stdout, stderr) => {
  if (err) {
    // node couldn't execute the command
    return;
  }
console.log('Importing JSON to MONGO');
        exec('mongoimport --db Recordings --collection Cameras --file /usr/node/video/recording/catalog.json ', (err, stdout, stderr) => {
  if (err) {
    // node couldn't execute the command
    return;
  }
checkcams=0;
console.log('Done');
});
})
     
	
          });
  //your code to be executed after 1 second
}, delayInMilliseconds);}



      } else if (that.state === 'sleeping' && isWorkTime) {
        setTimeout(reSpawn, 3000);
        changeState('running');

      }
    }
  }
else{
   var end= moment(endDay).format("YYYYMMDD");
    
    var startdd=st.format("YYYYMMDD");
    if(today>end){
log('Day passed. Closing socket to record');

process.kill(process.pid);

}
if(startdd==today){
    if (thisDay !== today) {
      thisDay = today;
      todayDir = path.join(recordingDir, cameraName, thisDay);
      fse.ensureDir(todayDir, function (){
        if (that.state === 'running') {
          changeState('restarting');
          ffmpeg.stop();
        }
        startTime = moment(options.startTime, 'HH:mm:ss');
        stopTime = moment(options.stopTime, 'HH:mm:ss');
      });
    } else {
      var isWorkTime = moment().diff(startTime) > 0 && moment().diff(stopTime) < 0;
      if (stopTime.diff(startTime) < 0) {
        isWorkTime = !isWorkTime;
      } else if (stopTime.diff(startTime) === 0) {
        isWorkTime = true;
      }
      if (that.state === 'running' && !isWorkTime) {
        finishedDay = thisDay;
        changeState('to_sleeping');
	st.add(1,'d');
        ffmpeg.stop();
checkcams=checkcams+1;
if(checkcams==numcameras){
	setTimeout(function() {

return cleaner.clean()
	.then(cataloger.rebuildAll)
      .then(cataloger.write)
      .then(function (){
        
    
          });
  //your code to be executed after 1 second
}, delayInMilliseconds);}
	
	
	
      } else if (that.state === 'sleeping' && isWorkTime) {
        setTimeout(reSpawn, 3000);
        changeState('running');

      }
    }
  }
}
}


  return that;
};

