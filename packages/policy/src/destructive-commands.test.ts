/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { isDestructiveCommand } from '@vybestack/llxprt-code-policy';
describe('isDestructiveCommand', () => {
  describe('pattern A: rm targeting sensitive roots', () => {
    it.each([
      ['rm -rf /', 'root with -rf'],
      ['rm -rf /usr', '/usr'],
      ['rm -rf /etc', '/etc'],
      ['rm -rf /home', '/home'],
      ['rm -rf /var', '/var'],
      ['rm -rf /opt', '/opt'],
      ['rm -fr /', 'reversed flags -fr'],
      ['rm --recursive --force /', 'long flags'],
      ['rm -r /', 'single -r (no force)'],
      ['rm -rf /*', 'glob root contents'],
    ])('detects "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
    it('detects rm targeting home directory shorthand', () => {
      expect(isDestructiveCommand('rm -rf ~')).toBe(true);
      expect(isDestructiveCommand('rm -rf $HOME')).toBe(true);
      expect(isDestructiveCommand('rm -rf ${HOME}')).toBe(true);
    });
    it.each([
      ['rm -rf ./build', 'relative build dir'],
      ['rm -rf node_modules', 'node_modules'],
      ['rm -rf /tmp/foo', 'tmp subpath'],
      ['rm -rf /usr/local/app', 'usr subpath'],
      ['rm -rf /usr/local/mydir', 'usr/local subpath'],
      ['rm -rf ~/project', 'home subpath'],
      ['rm file.txt', 'single file'],
      ['rm -rf dist', 'dist dir'],
    ])('does NOT flag benign rm "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('pattern A wrapper peeling (sudo/timeout)', () => {
    it.each([
      ['sudo rm -rf /', 'behind sudo'],
      ['timeout 5 rm -rf /', 'behind timeout'],
      ['nohup rm -rf /', 'behind nohup'],
    ])('detects rm -rf / (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('pattern A bypass classes', () => {
    it.each([
      ["r''m -rf /", 'single-quote obfuscation (Class A)'],
      ['r\\m -rf /', 'backslash obfuscation (Class A)'],
      ['rm$IFS-rf$IFS/', '$IFS splitting (Class B)'],
      ['rm${IFS}-rf${IFS}/', '${IFS} splitting (Class B)'],
    ])('detects rm bypass "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('quoted string args are benign (name is the outer command)', () => {
    it.each([
      ['echo "rm -rf /"', 'echo with quoted rm string'],
      ['echo rm -rf /', 'bare echo rm (name=echo)'],
      ['git commit -m "rm -rf / cleanup"', 'git commit message containing rm'],
      ['grep "rm -rf" file', 'grep for rm pattern'],
    ])('does NOT flag benign "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('pattern B: mkfs', () => {
    it.each([
      ['mkfs.ext4 /dev/sda', 'mkfs.ext4'],
      ['mkfs /dev/sdb', 'bare mkfs'],
      ['mkfs.ntfs /dev/sdc', 'mkfs.ntfs'],
    ])('detects "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('pattern C: dd to a device', () => {
    it.each<[string, boolean]>([
      ['dd of=/dev/sda', true],
      ['dd if=/dev/zero of=/dev/sda', true],
      ['dd if=/dev/urandom of=./disk.img', false],
      ['dd of=/dev/fd/0', false],
      ['dd of=/dev/fd/3', false],
      ['dd of=/dev/null', false],
    ])('dd "%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('pattern D: chmod dangerous', () => {
    it.each<[string, boolean]>([
      ['chmod +s /bin/bash', true],
      ['chmod u+s x', true],
      ['chmod g+s y', true],
      ['chmod 2777 x', true],
      ['chmod 6777 /x', true],
      ['chmod -R 777 /', true],
      ['chmod 644 file', false],
      ['chmod 0755 ./bin', false],
      ['chmod +x script.sh', false],
      ['chmod 1777 /tmp', false],
      ['chmod -R 755 ./dir', false],
    ])('chmod "%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('pattern E: credential-path writes', () => {
    it.each<[string, boolean]>([
      ['echo pwned > ~/.ssh/authorized_keys', true],
      ['cat x >> $HOME/.ssh/authorized_keys', true],
      ['tee $HOME/.aws/credentials', true],
      ['truncate -s 0 ~/.ssh/authorized_keys', true],
      ['truncate -s 0 ~/.aws/credentials', true],
      ['echo x > ./out.txt', false],
      ['echo x > ~/notes.md', false],
      ['truncate -s 0 ./build/log', false],
    ])('credential write "%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('pattern F: fork bomb', () => {
    it.each<[string, boolean]>([
      [':(){ :|:& };:', true],
      [':(){ :|:& }; :', true],
      ['bomb(){ bomb|bomb & };bomb', true],
      ['f(){ echo hi; }; f', false],
    ])('fork bomb "%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('command substitution extraction (Class C)', () => {
    it.each([
      ['echo "$(rm -rf /)"', 'rm inside $() in double quotes'],
      ['echo `rm -rf /`', 'rm inside backtick substitution'],
      ['echo $(rm -rf /)', 'rm inside $() without quotes'],
    ])('detects "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('compound commands', () => {
    it.each([
      ['echo hi && rm -rf /', 'after &&'],
      ['echo hi || rm -rf /', 'after ||'],
      ['echo hi; rm -rf /', 'after semicolon'],
      ['echo hi | rm -rf /', 'after pipe'],
      ['rm -rf / &', 'backgrounded'],
      ['echo hi\nrm -rf /', 'on second line'],
    ])('detects destructive command "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('A1: single-quoted command substitution is literal (benign)', () => {
    it.each([
      ["echo '$(rm -rf /)'", 'single-quoted dollar-paren'],
      ["git commit -m '$(rm -rf /)'", 'single-quoted in git -m'],
      ["printf '%s' '$(rm -rf /)'", 'single-quoted in printf'],
      ["echo '`rm -rf /`'", 'single-quoted backticks'],
    ])('does NOT flag benign single-quoted "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      ['echo "$(rm -rf /)"', 'double-quoted dollar-paren still executes'],
      ['echo `rm -rf /`', 'unquoted backticks still execute'],
    ])('STILL flags executing substitution "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('A2: dd to safe pseudo-devices is benign', () => {
    it.each([
      ['dd if=/dev/zero of=/dev/null', '/dev/null target'],
      ['dd of=/dev/null', '/dev/null only'],
      ['dd of=/dev/zero', '/dev/zero'],
      ['dd of=/dev/random', '/dev/random'],
      ['dd of=/dev/urandom', '/dev/urandom'],
      ['dd of=/dev/tty', '/dev/tty'],
      ['dd of=/dev/stdout', '/dev/stdout'],
      ['dd of=/dev/stderr', '/dev/stderr'],
      ['dd if=/dev/zero of=/dev/null bs=1M count=10', 'full pseudo-device dd'],
    ])('does NOT flag dd to safe pseudo-device "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      ['dd of=/dev/sda', 'real block device'],
      ['dd of=/dev/nvme0n1', 'nvme device'],
    ])('STILL flags dd to real device "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('B1: absolute/relative path command names', () => {
    it.each([
      ['/bin/rm -rf /', 'absolute rm'],
      ['/usr/bin/rm -rf /', 'deep absolute rm'],
      ['./rm -rf /', 'relative rm'],
      ['/sbin/mkfs.ext4 /dev/sda', 'absolute mkfs'],
      ['/usr/bin/dd of=/dev/sda', 'absolute dd'],
    ])('flags destructive absolute-path command "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it('keeps /bin/ls benign', () => {
      expect(isDestructiveCommand('/bin/ls')).toBe(false);
    });
  });

  describe('B2: adjacent command substitutions', () => {
    it('flags "$(true)$(rm -rf /)" adjacent substitutions', () => {
      expect(isDestructiveCommand('echo "$(true)$(rm -rf /)"')).toBe(true);
    });

    it('flags unquoted adjacent $(true)$(rm -rf /)', () => {
      expect(isDestructiveCommand('echo $(true)$(rm -rf /)')).toBe(true);
    });
  });

  describe('B3: sudo with option-taking operands', () => {
    it.each([
      ['sudo -u root rm -rf /', 'sudo -u root'],
      ['sudo --user root rm -rf /', 'sudo --user root'],
      ['sudo -g wheel rm -rf /', 'sudo -g wheel'],
      ['doas -u root rm -rf /', 'doas -u root'],
    ])('flags destructive "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['sudo rm -rf /', 'plain sudo'],
      ['timeout 5 rm -rf /', 'timeout with number'],
      ['env FOO=bar rm -rf /', 'env with assignment'],
      ['nice -n 10 rm -rf /', 'nice with -n operand'],
    ])('STILL flags destructive "%s" (no regression)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('B4: attached, fd-prefixed, and whitespace credential redirects', () => {
    it.each<[string, boolean]>([
      ['echo pwned >~/.ssh/authorized_keys', true],
      ['cat x >>$HOME/.ssh/authorized_keys', true],
      ['echo x 2>~/.aws/credentials', true],
      ['echo x 1>~/.ssh/authorized_keys', true],
      ['echo x &>~/.aws/credentials', true],
      ['cat x >> ~/.aws/credentials', true],
      ['echo x > ~/.ssh/authorized_keys', true],
      ['echo x >  ~/.ssh/authorized_keys', true],
      ['echo x >	~/.ssh/authorized_keys', true],
      ['echo x >./out.txt', false],
      ['echo x >~/notes.md', false],
      ['echo x > out.txt', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('C1: chmod special-bit setuid combined', () => {
    it.each([
      ['chmod 4777 x', 'setuid 4777'],
      ['chmod 5777 x', 'setuid+setgid 5777'],
      ['chmod 04777 x', '0-prefixed 4777'],
    ])('flags destructive chmod "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['chmod 1777 /tmp', 'sticky-only 1777'],
      ['chmod 644 file', 'normal 644'],
      ['chmod 0755 ./bin', '0755'],
    ])('does NOT flag benign chmod "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('C2: trailing repeated slashes on sensitive roots', () => {
    it.each([
      ['rm -rf /etc//', '/etc//'],
      ['rm -rf /usr//', '/usr//'],
      ['rm -rf /home//', '/home//'],
      ['rm -rf /var//', '/var//'],
      ['rm -rf /opt//', '/opt//'],
      ['rm -rf ///', 'triple-slash root'],
    ])('flags destructive "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it('does NOT flag rm -rf /etc/foo', () => {
      expect(isDestructiveCommand('rm -rf /etc/foo')).toBe(false);
    });
  });

  describe('C3: interpreter -c flag executes its argument', () => {
    it.each([
      ['bash -c "rm -rf /"', 'bash -c double-quoted'],
      ["sh -c 'rm -rf /'", 'sh -c single-quoted arg'],
      ['zsh -c "mkfs.ext4 /dev/sda"', 'zsh -c mkfs'],
      ['dash -c "rm -rf /"', 'dash -c'],
      ['ksh -c "rm -rf /"', 'ksh -c'],
    ])('flags destructive interpreter -c "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['bash -c "ls"', 'bash -c ls benign'],
      ['bash script.sh', 'bash running a script file'],
      ['sh -c "echo hi"', 'sh -c echo benign'],
    ])('does NOT flag benign interpreter use "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it.each<[string, boolean]>([
      ['', false],
      ['   ', false],
      ['ls -la', false],
      ['find . -name x', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('round-2 defect A: quote-aware secondary splitting', () => {
    it.each([
      ['echo "hi & rm -rf /"', 'quoted ampersand is not a separator'],
      [
        'printf "hello\\nrm -rf /\\n"',
        'literal backslash-n inside double quotes',
      ],
      ['printf "hello\nrm -rf /\n"', 'real newline inside double quotes'],
    ])('does NOT flag benign quoted "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      ['echo hi && rm -rf /', 'unquoted && separator still works'],
      ['rm -rf / &', 'unquoted trailing & background'],
      ['echo a & rm -rf /', 'unquoted & separator'],
    ])('STILL flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it('STILL flags real unquoted newline-separated destructive command', () => {
      expect(isDestructiveCommand('echo hi\nrm -rf /')).toBe(true);
    });
  });

  describe('round-2 defect B: quote-aware credential redirection', () => {
    it.each([
      [
        'git commit -m "write > ~/.ssh/authorized_keys in docs"',
        'quoted > and credential path in commit message',
      ],
      ["echo '> ~/.aws/credentials'", 'single-quoted redirect literal'],
      ['grep "> ~/.ssh/config" README.md', 'double-quoted redirect literal'],
    ])('does NOT flag benign quoted "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      ['echo x > ~/.ssh/authorized_keys', 'real redirect to ssh'],
      ['echo pwned >~/.ssh/authorized_keys', 'attached redirect to ssh'],
      ['cat x >>$HOME/.ssh/authorized_keys', 'attached >> to ssh'],
      ['echo x 2>~/.aws/credentials', 'fd-prefixed 2> to aws'],
    ])('STILL flags destructive credential redirect "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each<[string, boolean]>([
      ['echo x > ./out.txt', false],
      ['echo x > "~/.ssh/authorized_keys"', true],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('round-2 defect C: double-quoted substitution with literal quotes', () => {
    it.each([
      ['echo "\'$(rm -rf /)\'"', 'double-quoted with single-quoted $()'],
      ['echo "before \'$(rm -rf /)\' after"', 'embedded single-quoted $()'],
      ['echo "\'`rm -rf /`\'"', 'double-quoted single-quote-wrapped backtick'],
    ])('flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ["echo '$(rm -rf /)'", 'single-quoted $() stays benign', false],
      ['echo "$(rm -rf /)"', 'double-quoted $() still executes', true],
    ])(
      'reaffirm "%s" (%s) -> %s',
      (command, description: string, expected: boolean) => {
        expect(isDestructiveCommand(command)).toBe(expected);
      },
    );
  });

  describe('round-2 defect D: dot-segment sensitive paths', () => {
    it.each([
      ['rm -rf /./', 'root with dot segment'],
      ['rm -rf /etc/./', 'etc with trailing dot'],
      ['rm -rf /etc/../etc', 'etc via parent traversal'],
      ['rm -rf /usr/..', 'root via parent traversal'],
      ['rm -rf /tmp/../etc', 'etc via tmp parent traversal'],
    ])('flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['rm -rf ./build', 'relative build dir stays benign'],
      ['rm -rf /etc/foo', 'etc subpath stays benign'],
      ['rm -rf /tmp/../tmp/x', 'tmp via parent stays benign'],
      ['rm -rf /usr/local/app', 'usr subpath stays benign'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('round-2 defect E: clustered interpreter short options with c', () => {
    it.each([
      ['bash -lc "rm -rf /"', 'bash -lc cluster'],
      ['sh -ec "rm -rf /"', 'sh -ec cluster'],
    ])('flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['bash -c "ls"', 'plain -c with benign command stays benign'],
      ['bash script.sh', 'script file stays benign'],
      ['bash -x script.sh', '-x cluster without c stays benign'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('Fix 1: POSIX -- option terminator in rm', () => {
    it.each([
      ['rm -- -rf /', 'recursive flag after -- is a filename'],
      ['rm -- -fr /etc', 'reversed recursive flag after -- is a filename'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      ['rm -rf /', 'recursive flag before any -- still flagged'],
      ['rm -rf -- /', 'flag before --, target / after -- still flagged'],
      ['rm -fr /etc', 'reversed flags before any -- still flagged'],
    ])('STILL flags destructive rm "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('Fix 1: POSIX -- option terminator in chmod', () => {
    it.each([['chmod -- -R 777 /', 'recursive flag after -- is a filename']])(
      'does NOT flag benign "%s" (%s)',
      (command) => {
        expect(isDestructiveCommand(command)).toBe(false);
      },
    );

    it.each([
      ['chmod -R 777 /', 'recursive before any -- still flagged'],
      [
        'chmod -R -- 777 /',
        'recursive before --, mode and target after -- still flagged',
      ],
    ])('STILL flags destructive chmod "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('Fix 2: timeout operand-taking flags', () => {
    it.each([
      [
        'timeout --signal KILL 5 rm -rf /',
        'timeout --signal consumes KILL as operand',
      ],
      ['timeout -s KILL 5 rm -rf /', 'timeout -s consumes KILL as operand'],
      ['timeout -k 5 10 rm -rf /', 'timeout -k consumes 5 as operand'],
      ['timeout 5 rm -rf /', 'plain timeout with duration still flagged'],
      ['timeout 10s rm -rf /', 'timeout duration with seconds suffix'],
      [
        'timeout 1.5m rm -rf /',
        'timeout fractional duration with minutes suffix',
      ],
    ])('flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['timeout 5 ls', 'benign timeout with ls stays benign'],
      ['timeout --signal KILL 5 ls', 'benign timeout --signal ls stays benign'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('Fix 3: deeply nested substitution extraction', () => {
    it.each<[string, boolean]>([
      ['echo "$(echo $(echo $(rm -rf /)))"', true],
      ['echo $(echo $(echo $(echo $(rm -rf /))))', true],
      ['echo "$(rm -rf /)"', true],
      ['echo "$(true)$(rm -rf /)"', true],
      ['echo `rm -rf /`', true],
      ['echo "$(date)"', false],
      ['echo "$(echo hi)"', false],
      ['echo hi', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix 4: escaped double-quotes in interpreter tokenizer', () => {
    it('flags destructive 3-level nested bash -c with escaped quotes', () => {
      // Raw command: bash -c "bash -c 'bash -c \"rm -rf /\"'"
      const cmd = String.raw`bash -c "bash -c 'bash -c \"rm -rf /\"'"`;
      expect(isDestructiveCommand(cmd)).toBe(true);
    });

    it.each([
      [
        'bash -c "bash -c \\"rm -rf /\\""',
        'nested bash -c with escaped inner double-quotes',
      ],
      ['bash -c "rm -rf /"', 'plain bash -c still flagged'],
      ['sh -ec "rm -rf /"', 'sh -ec cluster still flagged'],
    ])('STILL flags "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['bash -c "ls"', 'benign bash -c ls stays benign'],
      ['bash -c "echo \\"hi\\""', 'benign escaped-quote echo stays benign'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe("Fix 5: ANSI-C quoting $'...' is unwrapped (false negative)", () => {
    it.each([
      ["rm $'-rf' /", 'ANSI-C quoted flag'],
      ["r$'m' -rf /", 'ANSI-C quoted command name fragment'],
      ["rm -$'r'f /", 'ANSI-C quoted letter inside flag'],
      ["bash -c $'rm -rf /'", 'ANSI-C quoted interpreter script'],
      ["rm$IFS$'-rf'$IFS/", 'ANSI-C mixed with $IFS splitting'],
    ])('flags destructive "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ["echo $'hi'", 'benign ANSI-C echo'],
      ["echo 'hi'", 'benign plain single-quoted echo stays benign'],
      ["rm -rf './build'", 'benign single-quoted relative target stays FALSE'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('Fix 6: absolute-path wrapper peeling (false negative)', () => {
    it.each([
      ['/usr/bin/sudo -u root rm -rf /', 'path-qualified sudo'],
      ['/usr/bin/env rm -rf /', 'path-qualified env'],
      ['/usr/bin/timeout 5 rm -rf /', 'path-qualified timeout'],
      ['/usr/local/bin/sudo rm -rf /', 'deep path-qualified sudo'],
      ['sudo -u root rm -rf /', 'plain sudo still flagged'],
      ['/usr/bin/rm -rf /', 'path-qualified rm (not a wrapper) still flagged'],
    ])('flags destructive "%s" (%s) (no regression)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      [
        '/usr/bin/env NODE_ENV=prod node app.js',
        'benign path-qualified env with node stays FALSE',
      ],
      ['env', 'bare env with no destructive follow stays FALSE'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('Fix 7: home-root-equivalent dot/slash normalization (false negative)', () => {
    it.each<[string, boolean]>([
      ['rm -rf ~//', true],
      ['rm -rf ~/.', true],
      ['rm -rf $HOME/.', true],
      ['rm -rf ${HOME}/.', true],
      ['rm -rf ~//.', true],
      ['rm -rf $HOME//.', true],
      ['rm -rf ~/./', true],
      ['rm -rf ${HOME}/./', true],
      ['rm -rf ~', true],
      ['rm -rf ~/', true],
      ['rm -rf $HOME', true],
      ['rm -rf ${HOME}', true],
      ['rm -rf ~/*', true],
      ['rm -rf ~/.cache', false],
      ['rm -rf ~/project', false],
      ['rm -rf ~/.ssh', false],
      ['rm -rf ~/.config/x', false],
      ['rm -rf $HOME/work', false],
      ['rm -rf /x', false],
      ['echo "$(rm -rf /x)"', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix 8: backtick scanning honors backslash escapes and inner quotes (false negative)', () => {
    it.each([
      ['echo `echo "x" && rm -rf /`', 'rm inside backtick with double quote'],
      ['echo `rm -rf /`', 'plain backtick rm (regression)'],
      [
        'echo `echo "hi"`; echo `rm -rf /`',
        'second adjacent backtick (regression)',
      ],
    ])('flags destructive "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ['echo "hi"', 'benign command with no backtick'],
      ['echo `echo hi`', 'benign backtick body'],
    ])('does NOT flag benign "%s"', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('Fix 9: backslash inside single quotes in command substitution (false negative)', () => {
    it.each<[string, boolean]>([
      ["echo $(rm -rf /; echo 'x\\' )", true],
      ["echo $(echo 'a\\'; rm -rf /)", true],
      ['echo $(rm -rf /)', true],
      ['echo "$(rm -rf /)"', true],
      ["echo $(echo 'a\\')", false],
      ['echo "$(ls)"', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix 10: wrapper-specific operand-taking flags (false negative)', () => {
    it.each<[string, boolean]>([
      ['sudo -s rm -rf /', true],
      ['sudo -s -- rm -rf /', true],
      ['timeout -s KILL 5 rm -rf /', true],
      ['timeout --signal KILL 5 rm -rf /', true],
      ['timeout -k 5 10 rm -rf /', true],
      ['sudo -u root rm -rf /', true],
      ['sudo rm -rf /', true],
      ['/usr/bin/sudo -u root rm -rf /', true],
      ['timeout 5 ls', false],
      ['sudo ls', false],
      ['sudo -u root ls', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe("ANSI-C $'...' interpreter -c script is decomposed (false negative)", () => {
    it.each([
      [
        "bash -c $'echo hi; rm -rf /'",
        'semicolon-separated rm inside ANSI-C script',
      ],
      [
        "bash -c $'echo $(rm -rf /)'",
        'command substitution inside ANSI-C script',
      ],
      ["sh -c $'ls\nrm -rf /'", 'newline-separated rm inside ANSI-C script'],
      ["bash -c $'rm -rf /'", 'bare ANSI-C rm script still flagged'],
      [
        'bash -c "echo hi; rm -rf /"',
        'double-quoted semicolon script still flagged',
      ],
      [
        'bash -c "echo $(rm -rf /)"',
        'double-quoted substitution script still flagged',
      ],
    ])('flags destructive "%s" (%s) (no regression)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });

    it.each([
      ["bash -c $'echo hi; echo bye'", 'benign ANSI-C compound script'],
      ["bash -c $'echo done'", 'benign ANSI-C single command'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });
  });

  describe('fork-bomb requires self-reference in function body (false positive)', () => {
    it.each([
      [
        'foo(){ echo bar | baz & }; foo',
        'non-recursive function with pipe and background',
      ],
      [
        'log(){ tail -f x | grep y & }; log',
        'non-recursive logging function with pipe and background',
      ],
      ['echo hi | grep h', 'plain pipe with no function'],
    ])('does NOT flag benign "%s" (%s)', (command) => {
      expect(isDestructiveCommand(command)).toBe(false);
    });

    it.each([
      [':(){ :|:& };:', 'classic fork bomb still flagged'],
      ['bomb(){ bomb|bomb & }; bomb', 'named fork bomb still flagged'],
    ])('STILL flags destructive "%s" (%s) (no regression)', (command) => {
      expect(isDestructiveCommand(command)).toBe(true);
    });
  });

  describe('process substitution <() and >()', () => {
    it.each<[string, boolean]>([
      ['cat <(rm -rf /)', true],
      ['tee >(rm -rf /)', true],
      ['cat <(ls)', false],
      ['diff <(ls) <(cat foo)', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix A: process substitution inside double quotes is literal (false positive)', () => {
    it.each<[string, boolean]>([
      ['echo "<(rm -rf /)"', false],
      ['echo ">(rm -rf /)"', false],
      ['printf "%s" "<(rm -rf /)"', false],
      ["echo '<(rm -rf /)'", false],
      ['cat <(rm -rf /)', true],
      ['tee >(rm -rf /)', true],
      ['echo "$(rm -rf /)"', true],
      ['echo `rm -rf /`', true],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix B: zero-padded octal chmod modes on recursive root (false negative)', () => {
    it.each<[string, boolean]>([
      ['chmod -R 00777 /', true],
      ['chmod -R 000777 /', true],
      ['chmod -R 0777 /', true],
      ['chmod -R 777 /', true],
      ['chmod 002777 x', true],
      ['chmod +s /bin/bash', true],
      ['chmod -R 644 /', false],
      ['chmod 644 file', false],
      ['chmod 755 ./bin', false],
      ['chmod 00777 file', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix C: backslash literal inside single quotes in tokenizer (consistency)', () => {
    it('does NOT flag sh -c with rm as positional args', () => {
      expect(isDestructiveCommand("sh -c 'echo hi\\' rm -rf /")).toBe(false);
    });
    it('STILL flags bash -c "rm -rf /"', () => {
      expect(isDestructiveCommand('bash -c "rm -rf /"')).toBe(true);
    });
  });

  describe('Fix D: env wrapper operand-taking flags (false negative)', () => {
    it.each<[string, boolean]>([
      ['env -u PATH rm -rf /', true],
      ['env --unset PATH rm -rf /', true],
      ['env -C /tmp rm -rf /', true],
      ['env --chdir /tmp rm -rf /', true],
      ['env --unset=PATH rm -rf /', true],
      ['env rm -rf /', true],
      ['env FOO=bar rm -rf /', true],
      ['env -i rm -rf /', true],
      ['sudo -u root rm -rf /', true],
      ['env -u PATH ls', false],
      ['env rm -rf ./build', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix E: ~/$HOME path escaping to a sensitive root (false negative)', () => {
    it.each<[string, boolean]>([
      ['rm -rf ~/..', true],
      ['rm -rf ~/../..', true],
      ['rm -rf $HOME/..', true],
      ['rm -rf ~/foo/..', true],
      ['rm -rf ~/.', true],
      ['rm -rf ~', true],
      ['rm -rf $HOME', true],
      ['rm -rf ~/', true],
      ['rm -rf /home', true],
      ['rm -rf /', true],
      ['rm -rf ~/../user/project', false],
      ['rm -rf ~/.cache', false],
      ['rm -rf ~/build', false],
      ['rm -rf ~/project/../build', false],
      ['rm -rf ~/node_modules', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix 1: chmod mode patterns respect the -- terminator (false positive)', () => {
    it.each<[string, boolean]>([
      ['chmod 644 -- 2777', false],
      ['chmod 644 -- 4777', false],
      ['chmod 644 -- +s_file', false],
      ['chmod 644 -- +sfile', false],
      ['chmod 2777 realfile', true],
      ['chmod +s /bin/bash', true],
      ['chmod u+s file', true],
      ['chmod g+s dir', true],
      ['chmod ug+rwxs file', true],
      ['chmod +sx file', true],
      ['chmod -R 777 /', true],
      ['chmod 644 file', false],
      ['chmod 755 ./bin', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('Fix 2: function-keyword fork bomb variant (false negative)', () => {
    it.each<[string, boolean]>([
      ['function b { b|b& }; b', true],
      ['function bomb { bomb|bomb & }; bomb', true],
      [':(){ :|:& };:', true],
      ['bomb(){ bomb|bomb & }; bomb', true],
      ['function log { echo hi | cat & }; log', false],
      ['foo(){ echo bar | baz & }; foo', false],
      ['function deploy { build && push; }; deploy', false],
      ['echo hi | grep h', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });

  describe('issue2387: credential redirect canonicalization + ~/.config subset', () => {
    it.each<[string, boolean]>([
      ["echo x > ~/.a''ws/credentials", true],
      ['echo x > ~/.a\\ws/credentials', true],
      ["cat x >> $HOME/.s''sh/authorized_keys", true],
      ["echo x >~/.a''ws/credentials", true],
      ['echo x > ~/.aws/credentials', true],
      ['echo x > ~/.ssh/authorized_keys', true],
      ['echo x >&~/.ssh/authorized_keys', true],
      ['echo x > $HOME/.aws/credentials', true],
      ['echo x > ~/.config/gh/hosts.yml', true],
      ['tee ~/.config/git/credentials', true],
      ['echo x > $HOME/.config/gcloud/credentials.db', true],
      ['truncate -s 0 ~/.config/gh/hosts.yml', true],
      ['echo x > ./build/log', false],
      ['echo x > ~/notes.md', false],
      ['echo x > ~/.awesome/notes', false],
      ['echo x > ~/.config/myapp/settings.json', false],
      ['echo x > ~/.config/nvim/init.vim', false],
      ['echo x > ~/.config/gh/config.yml', false],
      ['cat ~/.config/gh/hosts.yml', false],
    ])('"%s" -> %s', (command, expected) => {
      expect(isDestructiveCommand(command)).toBe(expected);
    });
  });
});
