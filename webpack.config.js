const path = require("path");
const UserscriptWebpackPlugin = require("./bin/UserscriptWebpackPlugin");
const TerserPlugin = require("terser-webpack-plugin");
const metadata = require("./bin/userscript-header");


const userscript = {
    entry: "./src/RE621.ts",
    mode: "production",
    devtool: "source-map",
    plugins: [
        new UserscriptWebpackPlugin({ metadata }),
    ],
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            /*
            {
                test: /\.s[ac]ss$/i,
                use: [ "to-string-loader", "css-loader", "sass-loader" ],
                exclude: /node_modules/,
            },*/

            {
                test: /.scss$/,
                exclude: /node_modules/,
                use: [
                    "sass-to-string",
                    {
                        loader: "sass-loader",
                        options: {
                            sassOptions: { outputStyle: "compressed", },
                        },
                    },
                ],
                exclude: /node_modules/,
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
    },
    output: {
        filename: "script.user.js",
        path: path.resolve(__dirname, "dist"),
    },
    optimization: {
        minimizer: [
            (compiler) => {
                new TerserPlugin({
                    terserOptions: {
                        format: { comments: false },
                        keep_classnames: true,
                    },
                    extractComments: false,
                }).apply(compiler);
            }
        ]
    },
    cache: true,
};

const metascript = {
    entry: "./bin/empty.js",
    mode: "production",
    plugins: [
        new UserscriptWebpackPlugin({ metadata }),
    ],
    output: {
        filename: "script.meta.js",
        path: path.resolve(__dirname, "dist"),
    },
    optimization: {
        usedExports: true,
        minimize: false,
        minimizer: [
            (compiler) => {
                new TerserPlugin({
                    terserOptions: {
                        format: { comments: false },
                    },
                    extractComments: false,
                }).apply(compiler);
            }
        ]
    },
};

module.exports = [
    userscript,
    metascript,
];