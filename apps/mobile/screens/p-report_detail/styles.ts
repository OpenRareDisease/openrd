import { StyleSheet } from 'react-native';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F23',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  kvRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  kvLabel: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  kvValue: {
    color: '#E5E7EB',
    fontSize: 13,
    flexShrink: 1,
    textAlign: 'right',
  },
  button: {
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5147FF',
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  summaryText: {
    color: '#E5E7EB',
    fontSize: 14,
    lineHeight: 20,
  },
  smallText: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 18,
  },
  codeBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  codeText: {
    color: '#E5E7EB',
    fontSize: 12,
    lineHeight: 16,
  },
  toggleLink: {
    marginTop: 8,
  },
  toggleLinkText: {
    color: '#969FFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
