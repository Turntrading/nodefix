var sys = require('sys');
var fs = require('fs');
var net = require('net');
var events = require('events');
var path = require('path');
var pipe = require('pipe');

//TODO
//Improve 'error' events. If sender/target exist, add them
//Clean up direct use of msg fields. Prefer the use of sender/target from context rather than trying to get fields directly (or do the opposite?)
//If no logon is established x seconds after connection, kill connection and notify client


//-----------------------------Expose server API-----------------------------
exports.createServer = function(func ) {
    var server = new Server(func);
    return server;
};

//TODO: handle error event, for example, when the listening port is already being used
function Server(func) {
     events.EventEmitter.call(this);

     this.sessions = {};

     var self = this;

     this.server = net.createServer(function(stream) {

        stream.setTimeout(2 * 60 * 1000);//if no traffic for two minutes, kill connection!
        var session = this;

        this.senderCompID = null;
        this.targetCompID = null;
        this.fixVersion = null;
        
        this.p = null;
        function SessionEmitterObj(){
            events.EventEmitter.call(this);
            this.write = function(data){session.p.pushOutgoing({data:data, type:'data'});};
        }
        sys.inherits(SessionEmitterObj,events.EventEmitter);

        this.sessionEmitter = new SessionEmitterObj();


        stream.on('connect', function() {
            session.sessionEmitter.emit('connect');
            
            session.p = pipe.makePipe(stream);
            session.p.addHandler(require('./handlers/fixFrameDecoder.js').newFixFrameDecoder());
            session.p.addHandler(require('./handlers/outMsgEvtInterceptor.js').newOutMsgEvtInterceptor(session));
            session.p.addHandler(require('./handlers/logonProcessorAcceptor.js').newlogonProcessorAcceptor());
            session.p.addHandler(require('./handlers/inMsgEvtInterceptor.js').newInMsgEvtInterceptor(session));
            session.p.addHandler(require('./handlers/sessionProcessor.js').newSessionProcessor(false));
            
            //session constants
            ctx.state.session['isInitiator'] = false;
            ctx.state.session['remoteAddress'] = ctx.stream.remoteAddress;

            //session defaults (may be over-written from inside the pipe)
            ctx.state.session['heartbeatDuration'] = 30;
            ctx.state.session['testRequestID'] = 1;
            ctx.state.session['isLoggedIn'] = false;
            ctx.state.session['isResendRequested'] = false;
            
            //session variables, set inside pipe, not here
            //ctx.state.session['fixVersion'] = fixVersion;
            //ctx.state.session['senderCompID'] = senderCompID;
            //ctx.state.session['targetCompID'] = targetCompID;
            //ctx.state.session['incomingSeqNum'] = incomingSeqNum;
            //ctx.state.session['outgoingSeqNum'] = outgoingSeqNum;
            //ctx.state.session['heartbeatDuration'] = parseInt(heartbeatInMilliSeconds,10) * 1000;
            //ctx.state.session['timeOfLastIncoming'] = new Date().getTime();
            //ctx.state.session['timeOfLastOutgoing'] = new Date().getTime();

            /*session.p.addHandler({incoming:function(ctx,event){
                if(event.type === 'session' && event.data === 'logon'){
                    session.senderCompID = ctx.state.session.senderCompID;
                    session.targetCompID = ctx.state.session.targetCompID;
                    session.fixVersion = ctx.state.session.fixVersion;

                    session.sessionEmitter.emit('logon',ctx.state.session.senderCompID,ctx.state.session.targetCompID);
                }
                else if(event.type === 'session' && event.data === 'logoff'){
                    session.sessionEmitter.emit('logoff',ctx.state.session.senderCompID,ctx.state.session.targetCompID);
                }
                else if(event.type==='error'){
                    session.sessionEmitter.emit('error', event.data);
                }
                
                ctx.sendNext(event);

            }});*/
            
        });
        stream.on('data', function(data) { session.p.pushIncoming({data:data, type:'data'}); });
        stream.on('timeout', function(){ stream.end(); });
        
        func(session.sessionEmitter);

     });
     
     self.server.on('error', function(err){ self.emit('error', err); });

     this.listen = function(port, host, callback) { self.server.listen(port, host, callback); };
     this.write = function(targetCompID, data) { self.sessions[targetCompID].write({data:data, type:'data'}); };
     this.logoff = function(targetCompID, logoffReason) { self.sessions[targetCompID].write({data:{35:5, 58:logoffReason}, type:'data'}); };
     this.kill = function(targetCompID, reason){ self.sessions[targetCompID].end(); };
     /*this.getMessages = function(callback){
        var fileName = './traffic/' + session.fixVersion + '-' + session.senderCompID + '-' + session.targetCompID + '.log';
        fs.readFile(fileName, encoding='ascii', function(err,data){
            if(err){
                callback(err,null);
            }
            else{
                var transactions = data.split('\n');
                callback(null,transactions);
            }
        });
    };*/


}
sys.inherits(Server, events.EventEmitter);

//-----------------------------Expose client API-----------------------------
exports.createConnection = function(fixVersion, senderCompID, targetCompID) {
    //return new Client({'8': fixVersion, '56': targetCompID, '49': senderCompID, '35': 'A', '90': '0', '108': '10'}, port, host, callback);
    return new Client(fixVersion, senderCompID, targetCompID);
};

/*exports.createConnectionWithLogonMsg = function(logonmsg, port, host, callback) {
    return new Client(logonmsg, port, host, callback);
};*/

function Client(fixVersion, senderCompID, targetCompID) {
    events.EventEmitter.call(this);
    

    this.session = null;
    var self = this;

    var stream = null;

    self.p = pipe.makePipe(stream);
    self.p.addHandler(require('./handlers/fixFrameDecoder.js').newFixFrameDecoder());
    self.p.addHandler(require('./handlers/outMsgEvtInterceptor.js').newOutMsgEvtInterceptor(session));
    self.p.addHandler(require('./handlers/logonProcessorInitiator.js').newlogonProcessorInitiator());
    self.p.addHandler(require('./handlers/inMsgEvtInterceptor.js').newInMsgEvtInterceptor(session));
    self.p.addHandler(require('./handlers/sessionProcessor.js').newSessionProcessor(true));

    //Set pipeliene's constants. All outgoing messages are auto-filled with this information
    //session constants
    self.p.state.session['fixVersion'] = fixVersion;
    self.p.state.session['senderCompID'] = senderCompID;
    self.p.state.session['targetCompID'] = targetCompID;
    self.p.state.session['isInitiator'] = true;
    
    //session defaults (may be over-written from inside the pipe)
    self.p.state.session['testRequestID'] = 1;
    self.p.state.session['isLoggedIn'] = false;
    self.p.state.session['isResendRequested'] = false;
    self.p.state.session['incomingSeqNum'] = 1;
    self.p.state.session['outgoingSeqNum'] = 1;
    
    //session values set inside pipe, not here
    //self.p.state.session['heartbeatDuration'] = heartbeatInMilliSeconds;
    //self.p.state.session['timeOfLastOutgoing'] = timeOfLastOutgoing;
    //self.p.state.session['timeOfLastIncoming'] = timeOfLastIncoming;

    /*this.p.addHandler({incoming:function(ctx,event){ 
        if(event.type==='session' && event.data==='logon'){
            self.emit('logon', ctx.state.session.senderCompID, ctx.state.session.targetCompID);
        }
        else if(event.type==='session' && event.data==='logoff'){
            self.emit('logoff', ctx.state.session.senderCompID, ctx.state.session.targetCompID);
        }
        else if(event.type==='error'){
            self.emit('error', event.data);
        }
        ctx.sendNext(event); 
    }});*/
    
    stream.on('connect', function() {
        self.emit('connect');
        self.p.pushOutgoing({data:logonmsg, type:'data'});
    });
    stream.on('data', function(data) { self.p.pushIncoming({data:data, type:'data'}); });

    //--CLIENT METHODS--
    this.write = function(data) { self.p.pushOutgoing(data); };
    this.createConnection(port, host, callback){
    
        self.p.state.session['remoteAddress'] = host;
        self.stream = net.createConnection(port, host, callback);
    }
    this.logon(){
        self.write({'35': 'A', '90': '0', '108': '10'});
    }
    this.connectAndLogon(port, host, callback){
        self.createConnection(port, host, function(error, data){
            if(error === null){
                self.logon();
                callback(null, data);
            }
            else{
                callback(error,data);
            }
        });
    }
    this.logoff = function(logoffReason){ self.p.pushOutgoing({data:{35:5, 58:logoffReason}, type:'data'}) };
    /*this.getMessages = function(callback){
        var fileName = './traffic/' + self.fixVersion + '-' + self.senderCompID + '-' + self.targetCompID + '.log';
        fs.readFile(fileName, encoding='ascii', function(err,data){
            if(err){
                callback(err,null);
            }
            else{
                var transactions = data.split('\n');
                callback(null,transactions);
            }
        });
    };*/
}
sys.inherits(Client, events.EventEmitter);


