// server.js
// where your node app starts

// init project
const express = require('express');
const app = express();
const fetch = require("node-fetch")
const request = require("request")
const fs = require("fs")
const LocalStorage = require("node-localstorage").LocalStorage;

//ls
if (typeof localStorage === "undefined" || localStorage === null) {
    localStorage = new LocalStorage('./scratch');
}

//create required directories
["./tmp"].forEach(async dir => {
    fs.existsSync(dir) || fs.mkdirSync(dir);
});

const getDate = () => {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '')
};

const getHour = () => {
    return `${getDate()}${new Date().toISOString().split("T")[1].slice(0, 2)}`;
}

const quota = {
    hourly: 40,
    set: (c) => {
        localStorage.setItem('quota', c);
    },
    reset: () => {
        localStorage.setItem('quota', 0);
    },
    get: () => {
        return localStorage.getItem('quota')
    },
    add: () => {
        let c = localStorage.getItem('quota');
        localStorage.setItem('quota', (+c) + 1);
    },
    substract: () => {
        let c = localStorage.getItem('quota');
        localStorage.setItem('quota', (+c) - 1);
    }
}

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/views/index.html');
});

app.get('/daily', async (req, res) => {
    res.json(await getCDNfiles());
});

const getCDNfiles = () => new Promise((resolve, reject) => {
    console.log(`[FTP] getting songs...`)
    var Client = require('ftp');
    var options = {
        host: process.env.FTP_HOST,
        port: 21,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASS_RO
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {

        c.cwd(getDate(), (err, list) => {

            c.listSafe((err, list) => {
                if (err) return reject(err);

                console.log(`[FTP-query] Listing songs...`)
              
              var files = [];
              for(const i in list){
                const entry = `https://${process.env.CDN}/${getDate()}/${list[i].name}`;
                files.push(entry)
              }
               resolve(files);
            });
            c.end(); //end client
           
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

// listen for requests :)
const listener = app.listen(process.env.PORT, function() {
    console.log('Your app is listening on port ' + listener.address().port);
});

const get = async (song) => new Promise((resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/play`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }).on('response', async file => {

        console.log(`[TMP] Writing °${song.name}° to disk...`);

        const fname = Buffer.from(song.name).toString('base64')
        var stream = file.pipe(fs.createWriteStream(`tmp/${fname}.mp3`));

        stream.on("error", (err) => {
            reject(err);
        });
        stream.on("finish", async () => {

            console.log(`[TMP] Written °${song.name}° to disk...`);

            
            await upload({
                host: process.env.FTP_HOST,
                port: 21,
                user: process.env.FTP_USER,
                password: process.env.FTP_PASS,
            }, `tmp/${fname}.mp3`, `${getDate()}/${fname}.mp3`);
            resolve();
        });
    })
});


//************ FTP custom (requires 'ftp')
const upload = async (credentials, pathToLocalFile, pathToRemoteFile) => new Promise((resolve, reject) => {
    var Client = require('ftp');
    var options = {
        host: credentials.host,
        port: credentials.port,
        user: credentials.user,
        password: credentials.password
    };
    var c = new Client();
    //on client ready, upload the file.
    c.on('ready', () => {
        console.log(`[FTP-upload] Upload of °${pathToLocalFile}° began...`)
        c.put(pathToLocalFile, pathToRemoteFile, function(err) {
            c.end(); //end client
            fs.unlink(pathToLocalFile, (error) => {
                /* handle error */
            });
            console.log(`[FTP-upload] Upload completed: °${pathToLocalFile}° => °${pathToRemoteFile}°`)
            if (err) reject(err); //reject promise
            resolve(); //fullfill promise
        });
    });
    //general error
    c.on('error', (err) => {
        return reject(err);
    });
    c.connect(options);
});

//Delete a song object frtom the AI server
const deleteSong = (song => new Promise(async (resolve, reject) => {
    request({
        url: `https://${process.env.HOST}/composition/delete`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            compositionID: song._id
        }
    }, (error, response, result) => {

        if (error === null) {
            console.log(`[AI] °${song.name}° was deleted on generating server.`);
            resolve();
        } else {
            console.error(error);
            return reject(error);
        }
    });
}));

//Create a new Song on AI server
const create = () => new Promise(async (resolve, reject) => {
    if (quota.get() < quota.hourly)
        request({
            url: `https://${process.env.HOST}/composition/original/createFromPreset`,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': process.env.TOKEN
            },
            json: {
                duration: "auto",
                ensemble: "auto",
                folderID: "",
                includeDrums: true,
                includeTempoMap: true,
                key: "auto",
                numberOfCompositions: "1",
                pacing: "auto",
                preset: "fantasy",
                timeSignature: "auto",
                token: process.env.TOKEN
            }
        }, (error, response, body) => {
            if (error === null) {
                const song = body.compositions[0];
                console.log(`[AI] #${song._id} (${song.name}) is getting created...`);
                quota.add();
                resolve();
                setTimeout(pumpSongs, 9999);
            } else {
                console.error(`[WARNING] ${error}`);
                return reject(error);
            }
        });
    else {
        console.log("[WARNING] Hourly quota reached.");
        setTimeout(() => {
            quota.reset();
        }, 1000 * 60 * (60));
    }
});

//Process songs on AI Server
const pumpSongs = () => {
    console.log(`[PUMPER] Refreshing state... [Creation Quota: ${quota.get()}/${quota.hourly} for hour ${getHour()}]`)
    //get songs
    request({
        url: `https://${process.env.HOST}/folder/getContent`,
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'Authorization': process.env.TOKEN
        },
        json: {
            folderID: "",
            getSharedContent: false,
            token: process.env.TOKEN
        }
    }, async (error, res, json) => {
        console.log("[PUMPER] Processing songs...")
        //if songs have been generated already
        if (json.compositions && json.compositions.length > 0) {
            //Songs löschen
            for (var key in json.compositions) {
                const song = json.compositions[key];
                console.log(`[AI] deleting °${song.name}°...`)

                if (song.isFinished) { //done
                    await get(song);
                    await deleteSong(song);
                }
                 setTimeout(pumpSongs, 31999);
            }
        } else create(); //create new if not existing
    });
};

setTimeout(pumpSongs, 9999);