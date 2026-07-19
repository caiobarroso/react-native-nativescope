/**
 * Versão do protocolo entre Studio, serviço local e runtime.
 *
 * O runtime vive no package.json do usuário e o Studio atualiza sozinho —
 * skew de versão é certeza, não risco. Toda mensagem carrega a versão, e o
 * handshake negocia capabilities antes de qualquer command trafegar.
 */
export const PROTOCOL_VERSION = 1;

export const DEFAULT_PORT = 4782;
