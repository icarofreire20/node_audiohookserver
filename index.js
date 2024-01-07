const express = require('express');
const request = require('request');
const { WebSocketServer } = require('ws');
const localtunnel = require ('localtunnel');
const { json } = require('body-parser');
const fs = require('fs');
const TwilioMediaStreamSaveAudioFile = require("twilio-media-stream-save-audio-file");
const {Leopard, LeopardActivationLimitReachedError } = require('@picovoice/leopard-node');
const wavefile = require ('wavefile');
const readline = require('readline');


// Set Audiostream websocket subdomain
// Set Picovoice access key 
const mylocaltunnelsubdomain = 'abetztesting';
const picovoiceaccessKey =  '9r382ygT3p6WjPA9XUAtwE0xA61PKYi8f0wxeZTEL8SO30kIcNEBmQ==';

//global variables
const server = express();
server.use(express.static('public'));
const wss = new WebSocketServer({port:8082});

let clientseq = 0;
let serverseq = 0;
let streamid = 0;

let tunnel = null;
let conversationid = null;

const mediaStreamSaver = new TwilioMediaStreamSaveAudioFile({
    saveLocation: "./",
    saveFilename: "audiostream",
    onSaved: () => transcribeme(conversationid),
});

//event handlers
process.stdin.on('keypress',(str,key) => {

    switch(str)
    {
        case 'q':
            
            tunnel.close();
            break;
        case 'p':
            PauseStream();
            break;
        case 'c':
            ResumePausedStream();
            break;
    }
});

wss.on('connection', function connection(ws) {
    Logger("INFO","New Websocket Connection");
    clientseq = 1;

    ws.on('message', (message) => {
        

        let jsonmessage = null;
        try {
            jsonmessage = JSON.parse(message);
            Logger("RECV",JSON.stringify(jsonmessage));
            
            //save current server sequence ID in case we need to send a pause request
            serverseq = jsonmessage.seq;
            streamid = jsonmessage.id;
        
            if(jsonmessage.type == 'open')
            {
                
                conversationid = jsonmessage.parameters.conversationId;

                var openedresponse = {
                    "version":jsonmessage.version,
                    "type":"opened",
                    "clientseq": serverseq,
                    "seq":clientseq++,
                    "id":streamid,
                    "parameters": {
                        "startPaused":false,
                        "media": [ jsonmessage.parameters.media[0]]
                    }
                }

                ws.send(JSON.stringify(openedresponse));
                mediaStreamSaver.twilioStreamStart();
                Logger("XMIT",JSON.stringify(openedresponse));
            }
            else if (jsonmessage.type == 'close')
            {
            
                var closedresponse = {
                        "version": jsonmessage.version,
                        "type": "closed",
                        "seq": clientseq++,
                        "clientseq":serverseq,
                        "id": streamid,
                        "parameters": {
                        }
                }
                ws.send(JSON.stringify(closedresponse));
                mediaStreamSaver.twilioStreamStop();
                Logger("XMIT",JSON.stringify(closedresponse));
            }   
            else if (jsonmessage.type == 'ping')
            {

                var pong = {
                    "version": jsonmessage.version,
                    "type": "pong",
                    "clientseq":serverseq,
                    "seq":clientseq++,
                    "id": streamid,
                    "parameters": { }
                }
                ws.send(JSON.stringify(pong));
                Logger("XMIT",JSON.stringify(pong));
            }
        } catch(e) 
        {
            Logger("RECV","Received audio chunk (message length " + message.length); 
            mediaStreamSaver.twilioStreamMedia(message);       
        }
    });

    ws.on('close', () => {
        Logger("INFO", "Websocket Disconnection");
      });
});

//functions
function Logger(state, data){
    console.log(new Date().toISOString() + " - " + state + " -- " + data );
}

function transcribeme(conversationid){
    Logger("INFO","Streamed audio written to file successfully")
    let wav = new wavefile.WaveFile(fs.readFileSync("./audiostream.wav"));
    wav.fromMuLaw();
    wav.toSampleRate(16000);
    fs.writeFileSync("./16audiostream.wav",wav.toBuffer());

    try {
        const engine = new Leopard(picovoiceaccessKey);
        const { transcript, words } = engine.processFile("16audiostream.wav");
        
        Logger("INFO","Conversation ID: " + conversationid + " transcript:");
        Logger("INFO",transcript);
        engine.release();

    } catch (err) {
        if (err instanceof LeopardActivationLimitReachedError) {
            Logger("ERROR","Picovoice AccessKey has reached it's processing limit.")
        } else {
          Logger("ERROR",err);
        }
    }
    
}

function PauseStream(){

    var message = {
        "version": "2",
        "type": "pause",
        "seq": clientseq++,
        "clientseq":serverseq,
        "id": streamid,
        "parameters": {
        }
    }
    wss.clients.forEach(function each(client) {
        client.send(JSON.stringify(message));
     });

    Logger("XMIT",JSON.stringify(message));
}

function ResumePausedStream(){

    var resumemessage = {
        "version": "2",
        "type": "resume",
        "seq": clientseq++,
        "clientseq":serverseq,
        "id": streamid,
        "parameters": {
        }
    }
    wss.clients.forEach(function each(client) {
        client.send(JSON.stringify(resumemessage));
     });

    Logger("XMIT",JSON.stringify(resumemessage));
}

function main()
{
  console.log("§§§§§§ press q to exit program, press p to pause running audiostream, press c to resume paused stream");
  Logger("INFO","Audiohook Server started.");
    process.stdin.setRawMode(true);
    readline.emitKeypressEvents(process.stdin);

    (async () => {
        tunnel = await localtunnel({port:8082,subdomain:mylocaltunnelsubdomain});
        Logger("INFO","Tunnel opened: " + tunnel.url);
        tunnel.on('close',() => {
            wss.close();
            Logger("INFO",tunnel.url + " closed");
            Logger("INFO","Audiohook Server ended.");
            process.exit();
        });
    })();

}

//init
main();

//resources
/*
https://console.picovoice.ai
https://www.npmjs.com/package/wavefile#change-the-sample-rate
https://www.npmjs.com/package/twilio-media-stream-save-audio-file
https://www.npmjs.com/package/commander
https://developer.genesys.cloud/devapps/audiohook/protocol-reference
*/


