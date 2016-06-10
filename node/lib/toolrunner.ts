
/// <reference path="../definitions/node.d.ts" />
/// <reference path="../definitions/Q.d.ts" />

import Q = require('q');
import os = require('os');
import events = require('events');
import child = require('child_process');

var run = function(cmd, callback) {
    console.log('running: ' + cmd);
    var output = '';
    try {
      
    }
    catch(err) {
        console.log(err.message);
    }

}

/**
 * Interface for exec options
 * 
 * @param     cwd        optional working directory.  defaults to current 
 * @param     env        optional envvar dictionary.  defaults to current processes env
 * @param     silent     optional.  defaults to false
 * @param     failOnStdErr     optional.  whether to fail if output to stderr.  defaults to false
 * @param     ignoreReturnCode     optional.  defaults to failing on non zero.  ignore will not fail leaving it up to the caller
 */
export interface IExecOptions {
    cwd: string;
    env: { [key: string]: string };
    silent: boolean;
    failOnStdErr: boolean;
    ignoreReturnCode: boolean;
    outStream: NodeJS.WritableStream;
    errStream: NodeJS.WritableStream;
};

/**
 * Interface for exec results returned from synchronous exec functions
 * 
 * @param     stdout      standard output
 * @param     stderr      error output
 * @param     code        return code
 * @param     error       Error on failure
 */
export interface IExecResult {
    stdout: string;
    stderr: string;
    code: number;
    error: Error;
}

export function debug(message) {
    // do nothing, overridden
};

export class ToolRunner extends events.EventEmitter {
    constructor(toolPath) {
        super();
        debug('toolRunner toolPath: ' + toolPath);

        this.toolPath = toolPath;
        this.args = [];
        this.silent = false;
    }

    public toolPath: string;
    public args: string[];
    public silent: boolean;

    private _debug(message) {
        if (!this.silent) {
            debug(message);
        }
        this.emit('debug', message);
    }

    private _argStringToArray(argString: string): string[] {
        var args = argString.match(/([^" ]*("[^"]*")[^" ]*)|[^" ]+/g);
        //remove double quotes from each string in args as child_process.spawn() cannot handle literla quotes as part of arguments
        for (var i = 0; i < args.length; i++) {
            args[i] = args[i].replace(/"/g, "");
        }
        return args;
    }

    /**
     * Add arguments
     * Accepts a full string command line and a string array as well
     * With literal=false, will handle double quoted args. E.g. val='"arg one" two -z', args[]=['arg one', 'two', '-z'] 
     * With literal=true, will put input direct into args. E.g. val='/bin/working folder', args[]=['/bin/working folder']
     * 
     * @param     val        string cmdline or array of strings
     * @param     literal    optional literal flag, if val is a string, add the original val to arguments when literal is true
     * @returns   void
     */
    public arg(val: any, literal?: boolean) {
        if (!val) {
            return;
        }

        if (val instanceof Array) {
            this._debug(this.toolPath + ' arg: ' + JSON.stringify(val));
            this.args = this.args.concat(val);
        }
        else if (typeof(val) === 'string') {
            if(literal) {
                this._debug(this.toolPath + ' literal arg: ' + val);
                this.args = this.args.concat(val);
            }
            else {
                this._debug(this.toolPath + ' arg: ' + val);
                this.args = this.args.concat(this._argStringToArray(val));    
            }
        }
    }

    /**
     * Add path argument
     * Add path string to argument, path string should not contain double quoted
     * This will call arg(val, literal?) with literal equal 'true' 
     * 
     * @param     val     path argument string
     * @returns   void
     */
    public pathArg(val: string) {
        this._debug(this.toolPath + ' pathArg: ' + val);
        this.arg(val, true);
    }
    
    /**
     * Add argument(s) if a condition is met
     * Wraps arg().  See arg for details
     *
     * @param     condition     boolean condition
     * @param     val     string cmdline or array of strings
     * @returns   void
     */
    public argIf(condition: any, val: any) {
        if (condition) {
            this.arg(val);
        }
    }

    /**
     * Exec a tool.
     * Output will be streamed to the live console.
     * Returns promise with return code
     * 
     * @param     tool     path to tool to exec
     * @param     options  optional exec options.  See IExecOptions
     * @returns   number
     */
    public exec(options?: IExecOptions): Q.Promise<number> {
        var defer = Q.defer<number>();

        this._debug('exec tool: ' + this.toolPath);
        this._debug('Arguments:');
        this.args.forEach((arg) => {
            this._debug('   ' + arg);
        });

        var success = true;
        options = options || <IExecOptions>{};

        var ops: IExecOptions = {
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: options.silent || false,
            outStream: options.outStream || process.stdout,
            errStream: options.errStream || process.stderr,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };

        var argString = this.args.join(' ') || '';
        var cmdString = this.toolPath;
        if (argString) {
            cmdString += (' ' + argString);
        }

        if (!ops.silent) {
            ops.outStream.write('[command]' + cmdString + os.EOL);    
        }

        // TODO: filter process.env

        var cp = child.spawn(this.toolPath, this.args, { cwd: ops.cwd, env: ops.env });

        cp.stdout.on('data', (data) => {
            this.emit('stdout', data);

            if (!ops.silent) {
                ops.outStream.write(data);    
            }
        });

        cp.stderr.on('data', (data) => {
            this.emit('stderr', data);

            success = !ops.failOnStdErr;
            if (!ops.silent) {
                var s = ops.failOnStdErr ? ops.errStream : ops.outStream;
                s.write(data);
            }
        });

        cp.on('error', (err) => {
            defer.reject(new Error(this.toolPath + ' failed. ' + err.message));
        });

        cp.on('exit', (code, signal) => {
            this._debug('rc:' + code);

            if (code != 0 && !ops.ignoreReturnCode) {
                success = false;
            }
            
            this._debug('success:' + success);
            if (success) {
                defer.resolve(code);
            }
            else {
                defer.reject(new Error(this.toolPath + ' failed with return code: ' + code));
            }
        });

        return <Q.Promise<number>>defer.promise;
    }

    /**
     * Exec a tool synchronously. 
     * Output will be *not* be streamed to the live console.  It will be returned after execution is complete.
     * Appropriate for short running tools 
     * Returns IExecResult with output and return code
     * 
     * @param     tool     path to tool to exec
     * @param     options  optionalexec options.  See IExecOptions
     * @returns   IExecResult
     */
    public execSync(options?: IExecOptions): IExecResult {
        var defer = Q.defer();

        this._debug('exec tool: ' + this.toolPath);
        this._debug('Arguments:');
        this.args.forEach((arg) => {
            this._debug('   ' + arg);
        });

        var success = true;
        options = options || <IExecOptions>{};

        var ops: IExecOptions = {
            cwd: options.cwd || process.cwd(),
            env: options.env || process.env,
            silent: options.silent || false,
            outStream: options.outStream || process.stdout,
            errStream: options.errStream || process.stderr,
            failOnStdErr: options.failOnStdErr || false,
            ignoreReturnCode: options.ignoreReturnCode || false
        };

        var argString = this.args.join(' ') || '';
        var cmdString = this.toolPath;
        if (argString) {
            cmdString += (' ' + argString);
        }

        if (!ops.silent) {
            ops.outStream.write('[command]' + cmdString + os.EOL);    
        }
        
        var r = child.spawnSync(this.toolPath, this.args, { cwd: ops.cwd, env: ops.env });
        if (r.stdout && r.stdout.length > 0) {
            ops.outStream.write(r.stdout);
        }

        if (r.stderr && r.stderr.length > 0) {
            ops.errStream.write(r.stderr);
        }

        return <IExecResult>{ code: r.status, stdout: r.stdout, stderr: r.stderr, error: r.error };
    }   
}
