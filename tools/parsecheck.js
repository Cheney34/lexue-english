// 一次性语法自检（用 JDK 8 自带的 Nashorn 解析，仅解析不执行）
// 用法：jjs -scripting tools\_parsecheck.js -- js/foo.js js/bar.js ...
var list = $ARG;
var bad = 0;
for (var i = 0; i < list.length; i++) {
    var f = list[i];
    var src = readFully(f);
    try {
        new Function(src);
        print('OK   ' + f);
    } catch (e) {
        bad++;
        print('FAIL ' + f + '  ' + e);
    }
}
print(bad === 0 ? 'ALL PARSE OK' : (bad + ' FILE(S) FAILED'));
exit(bad === 0 ? 0 : 1);
