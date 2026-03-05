import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'
import wp from 'webpack'
import { AngularWebpackPlugin } from '@ngtools/webpack'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

export default (env, argv) => {
    const isDev = argv?.mode === 'development'

    return {
        target: 'node',
        entry: './src/index.ts',
        context: __dirname,
        devtool: false,
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'index.js',
            pathinfo: true,
            libraryTarget: 'umd',
            publicPath: 'auto',
        },
        mode: isDev ? 'development' : 'production',
        optimization: {
            minimize: false,
        },
        resolve: {
            modules: ['.', 'src', 'node_modules', '../node_modules'].map(x => path.resolve(__dirname, x)),
            extensions: ['.ts', '.js'],
            mainFields: ['esm2015', 'browser', 'module', 'main'],
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: ['@ngtools/webpack'],
                },
                {
                    test: /\.pug$/,
                    use: ['apply-loader', { loader: 'pug-loader', options: { pretty: true } }],
                },
                { test: /\.scss$/, use: ['@tabby-gang/to-string-loader', 'css-loader', 'sass-loader'], include: /(theme.*|component)\.scss/ },
                { test: /\.scss$/, use: ['style-loader', 'css-loader', 'sass-loader'], exclude: /(theme.*|component)\.scss/ },
                { test: /\.css$/, use: ['@tabby-gang/to-string-loader', 'css-loader'], include: /component\.css/ },
                { test: /\.css$/, use: ['style-loader', 'css-loader'], exclude: /component\.css/ },
            ],
        },
        externals: [
            '@electron/remote',
            'electron',
            'fs',
            'os',
            'path',
            'net',
            'child_process',
            'readline',
            'stream',
            'russh',
            'ssh2',
            'ngx-toastr',
            'systeminformation',
            '@luminati-io/socksv5',
            'keytar',
            /^@angular(?!\/common\/locales)/,
            /^@ng-bootstrap/,
            /^rxjs/,
            /^tabby-/,
        ],
        plugins: [
            new AngularWebpackPlugin({
                tsconfig: path.resolve(__dirname, 'tsconfig.json'),
                directTemplateLoading: false,
                jitMode: true,
            }),
        ],
    }
}
